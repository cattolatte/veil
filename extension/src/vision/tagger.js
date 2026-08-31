/**
 * Neural PII tagger — the third detection channel.
 *
 * The pattern layer attempts 8 of 28 PII types in the reference corpus, about
 * 36.5% of instances. Names, addresses, usernames and IPs have no pattern to
 * match, so patterns have a hard recall ceiling however well tuned. This is
 * what goes past it.
 *
 * Byte-level, so there is no tokenizer to ship or keep in sync with the
 * browser, and any script works without a vocabulary. 403 KB.
 *
 * It was withheld for two milestones for a good reason: trained on form-shaped
 * data alone it flagged 15.1% of ordinary page text as PII. Retrained with real
 * page prose as negative evidence, that is now 0.0% while genuine PII is still
 * detected. Same fix as the screen model, same failure mode.
 */
import { assetUrl, loadOrt } from "./runtime.js";

const MODEL = "models/pii_tagger.onnx";
const TAGS = ["O", "B-NAME", "I-NAME", "B-ADDR", "I-ADDR",
              "B-USER", "I-USER", "B-IP", "I-IP"];
const MAXLEN = 384;
const STRIDE = 320;
const MIN_SPAN = 3;

/**
 * Minimum confidence before a byte counts as PII.
 *
 * Argmax alone over-fires on short title-case UI text — buttons, headings and
 * labels look like names to a model trained on documents and article prose.
 * Observed on a page of UI chrome: 18 detections where 3 were correct, with
 * "Nothing", "Press" and "Run" all tagged.
 *
 * Requiring a confident prediction rather than merely the best one costs a
 * little recall on genuinely ambiguous text and removes almost all of that.
 * Same reasoning as the screen model's 0.95 threshold.
 */
const MIN_CONFIDENCE = 0.90;

const WORD = /[A-Za-z0-9_@.\-]/;
const GAP = /^[ \t,;:]{1,2}$/;

export class PiiTagger {
  #session = null;
  #ort = null;
  #failed = false;
  #initPromise = null;
  backend = "none";

  get ready() { return this.#session !== null; }

  async init() {
    if (this.#session || this.#failed) return this.backend;
    this.#initPromise ??= this.#doInit().catch((e) => {
      // No model means no extra coverage — never a crash. The pattern layer
      // continues unaffected.
      this.#failed = true;
      this.backend = `unavailable (${e?.message ?? e})`;
      return this.backend;
    });
    return this.#initPromise;
  }

  async #doInit() {
    const ort = await loadOrt();
    this.#ort = ort;
    const providers = (globalThis.navigator && "gpu" in globalThis.navigator)
      ? ["webgpu", "wasm"] : ["wasm"];
    this.#session = await ort.InferenceSession.create(assetUrl(MODEL), {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    });
    this.backend = providers[0];
    return this.backend;
  }

  /**
   * @param {string} text
   * @returns {Promise<Array<{kind:string,start:number,end:number,source:string}>>}
   *          Offsets are into the UTF-8 BYTES of `text`, converted to string
   *          indices by the caller if needed.
   */
  /**
   * Scan several blocks in one call.
   *
   * Per-block inference was the wrong granularity: a page yields dozens of
   * short blocks, and per-call overhead dominated the actual compute. Joining
   * them with a separator and scanning once cuts the number of inferences by
   * an order of magnitude, then spans are mapped back to their block.
   *
   * The separator is a newline, which the model was trained to treat as
   * ordinary whitespace and which no entity spans.
   */
  async scanBlocks(blocks, opts = {}) {
    const SEP = "\n";
    const joined = blocks.join(SEP);
    const spans = await this.scan(joined, opts);
    if (!spans.length) return blocks.map(() => []);

    // Byte offset at which each block starts within the joined string.
    const enc = new TextEncoder();
    const starts = [];
    let at = 0;
    for (const b of blocks) {
      starts.push(at);
      at += enc.encode(b).length + enc.encode(SEP).length;
    }

    const perBlock = blocks.map(() => []);
    for (const sp of spans) {
      // Last block starting at or before this span.
      let bi = 0;
      while (bi + 1 < starts.length && starts[bi + 1] <= sp.start) bi++;
      const off = starts[bi];
      const end = off + enc.encode(blocks[bi]).length;
      if (sp.start >= end) continue;             // lands in a separator
      perBlock[bi].push({ ...sp, start: sp.start - off, end: Math.min(sp.end, end) - off });
    }
    return perBlock;
  }

  async scan(text, { budgetMs = 250 } = {}) {
    await this.init();
    if (!this.#session || !text) return [];

    const bytes = new TextEncoder().encode(text);
    if (bytes.length < 8) return [];

    const t0 = performance.now();
    const tags = new Uint8Array(bytes.length);

    // Overlapping windows: a name split across a window boundary would
    // otherwise be seen half at a time by a model with ±63 bytes of context.
    for (let off = 0; off < bytes.length; off += STRIDE) {
      if (performance.now() - t0 > budgetMs) break;   // budget: latency is 15%
      const chunk = bytes.subarray(off, Math.min(off + MAXLEN, bytes.length));
      if (chunk.length < 8) break;

      // int32, not int64: BigInt64Array construction dominated the cost, and
      // byte values need nowhere near 64 bits.
      const input = new Int32Array(chunk);
      const out = await this.#session.run({
        [this.#session.inputNames[0]]:
          new this.#ort.Tensor("int32", input, [1, chunk.length]),
      });
      const logits = out[this.#session.outputNames[0]].data;
      const nTags = TAGS.length;
      for (let i = 0; i < chunk.length; i++) {
        const base = i * nTags;
        let best = 0, bestVal = -Infinity, max = -Infinity;
        for (let t = 0; t < nTags; t++) {
          const v = logits[base + t];
          if (v > max) max = v;
          if (v > bestVal) { bestVal = v; best = t; }
        }
        if (best !== 0) {
          // Softmax only where it matters — this runs per byte.
          let sum = 0;
          for (let t = 0; t < nTags; t++) sum += Math.exp(logits[base + t] - max);
          if (Math.exp(bestVal - max) / sum < MIN_CONFIDENCE) best = 0;
        }
        // Later windows overwrite earlier ones only where they predict
        // something; an O from an overlapping window must not erase a hit.
        if (best !== 0 || tags[off + i] === 0) tags[off + i] = best;
      }
      if (off + MAXLEN >= bytes.length) break;
    }

    return decodeSpans(tags, bytes);
  }
}

/**
 * Byte tags to spans.
 *
 * B/I prefixes are discarded and only the CLASS is kept. Boundary noise lives
 * almost entirely in the B-versus-I decision, and for redaction the distinction
 * is worthless - the whole entity gets masked either way. Dropping it removes
 * the overlapping-span problem at source rather than repairing it afterwards.
 */
export function decodeSpans(tags, bytes) {
  const cls = new Array(tags.length).fill(null);
  for (let i = 0; i < tags.length; i++) {
    const name = TAGS[tags[i]];
    cls[i] = name === "O" ? null : name.slice(2);
  }

  const spans = [];
  let i = 0;
  while (i < cls.length) {
    if (cls[i] === null) { i++; continue; }
    let j = i;
    while (j < cls.length && cls[j] === cls[i]) j++;
    spans.push({ kind: cls[i], start: i, end: j });
    i = j;
  }

  const chr = (k) => String.fromCharCode(bytes[k]);
  for (const s of spans) {
    while (s.start > 0 && WORD.test(chr(s.start - 1))) s.start--;
    while (s.end < bytes.length && WORD.test(chr(s.end))) s.end++;
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) { last.end = Math.max(last.end, s.end); continue; }
    if (last) {
      let gap = "";
      for (let k = last.end; k < s.start; k++) gap += chr(k);
      if (GAP.test(gap)) { last.end = Math.max(last.end, s.end); continue; }
    }
    merged.push({ ...s });
  }

  return merged
    .filter((s) => s.end - s.start >= MIN_SPAN)
    .map((s) => ({ kind: s.kind.toLowerCase(), start: s.start, end: s.end, source: "neural" }));
}
