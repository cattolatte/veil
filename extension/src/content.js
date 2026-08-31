/**
 * Content script. Runs in the page, owns all sensitive data, and is the only
 * component that ever sees unredacted content.
 */
import { buildContext } from "./lib/serialize.js";
import { boxesFromRegions } from "./lib/redact.js";
import { VisionEngine } from "./vision/engine.js";
import { interactiveElements } from "./lib/dom.js";
import { api } from "./lib/browser.js";
import { PiiTagger } from "./vision/tagger.js";
import { redactText } from "./lib/redact.js";

const vision = new VisionEngine();
const tagger = new PiiTagger();
let overlay = null;

/** Debug overlay: draws what WOULD be redacted. Required to demonstrate redaction. */
function drawOverlay(context, regions) {
  overlay?.remove();
  overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647",
  });
  const mark = (box, color, label) => {
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "absolute", left: `${box.x}px`, top: `${box.y}px`,
      width: `${box.w}px`, height: `${box.h}px`,
      outline: `2px solid ${color}`, background: `${color}22`,
      font: "10px monospace", color, boxSizing: "border-box",
    });
    d.textContent = label;
    overlay.appendChild(d);
  };
  for (const el of context.elements) if (el.sensitive) mark(el.box, "#e11", el.sensitive);
  for (const r of regions) mark(r, "#e80", r.kind);
  document.documentElement.appendChild(overlay);
  setTimeout(() => overlay?.remove(), 4000);
}

/**
 * Neural pass over the page text.
 *
 * The pattern layer cannot detect a name - there is no pattern - so it has a
 * hard recall ceiling around 36.5% of PII types. This covers names, addresses,
 * usernames and IPs.
 *
 * It runs over the RAW block text, retained non-enumerably by buildContext and
 * deleted here before the context is returned. The raw text never leaves this
 * function.
 */
async function applyNeuralPass(context) {
  const raw = context.__rawChunks;
  if (!raw?.length) return null;

  const t0 = performance.now();
  let added = 0;
  const byKind = {};
  const redacted = [];

  const perBlock = await tagger.scanBlocks(raw);
  for (let bi = 0; bi < raw.length; bi++) {
    const block = raw[bi];
    const spans = perBlock[bi];
    if (!spans.length) { redacted.push(block); continue; }

    // Byte offsets from the tagger, converted to string indices.
    const bytes = new TextEncoder().encode(block);
    const dec = new TextDecoder();
    const mapped = spans.map((s) => ({
      kind: s.kind,
      start: dec.decode(bytes.subarray(0, s.start)).length,
      end: dec.decode(bytes.subarray(0, s.end)).length,
    })).sort((a, b) => a.start - b.start);

    const { text } = redactText(block, mapped);
    redacted.push(text);
    added += mapped.length;
    for (const m of mapped) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  }

  if (added) {
    // Re-derive the transmitted text from the neurally-redacted blocks, so the
    // pattern placeholders and the neural ones both survive.
    context.text = redacted.join(" ").slice(0, 8000);
    context.stats.redactedSpans += added;
    for (const [k, v] of Object.entries(byKind)) {
      context.stats.byKind[k] = (context.stats.byKind[k] || 0) + v;
    }
  }
  return { added, byKind, ms: +(performance.now() - t0).toFixed(1), backend: tagger.backend };
}

async function capture({ debug = false, neural = false } = {}) {
  const t0 = performance.now();
  const context = buildContext({ retainRawText: neural });
  // Neural pass first: it works on the raw text, which must be gone before
  // anything is serialised.
  if (neural) {
    try {
      context.neural = await applyNeuralPass(context);
    } catch (e) {
      // A failed neural pass loses coverage, never protection - the pattern
      // layer has already redacted independently.
      context.neural = { error: String(e?.message ?? e) };
    }
  }
  delete context.__rawChunks;

  const regions = await vision.findSensitiveRegions(context.visualCandidates);
  context.visualRedactions = boxesFromRegions(regions, context.viewport.dpr);
  delete context.visualCandidates;          // raw boxes never leave the client
  context.totalMs = +(performance.now() - t0).toFixed(1);
  if (debug) drawOverlay(context, regions);
  return context;
}

/**
 * Set a value the way a user would, so framework-controlled inputs notice.
 *
 * React and friends install a value setter on the element and track the last
 * value they wrote. Assigning `el.value` directly bypasses that tracker, so
 * the framework re-renders the old value straight back and the typing appears
 * to do nothing. Calling the *prototype* setter updates the underlying value
 * where the tracker can see it.
 */
function setValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Execute a server-returned action.
 *
 * The element is resolved from the SAME query serialize.js indexed against —
 * imported, not retyped — because a drifted copy would shift every index and
 * click the wrong control.
 */
function execute(action) {
  const el = interactiveElements()[action.index];
  switch (action.type) {
    case "click":  el?.click(); return !!el;
    case "type":   if (!el) return false; el.focus(); setValue(el, action.text ?? ""); return true;
    case "scroll": scrollBy({ top: action.dy ?? 400, behavior: "smooth" }); return true;
    case "noop":   return true;
    default:       return false;
  }
}

api.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.cmd === "capture") { capture(msg).then(respond); return true; }
  if (msg.cmd === "execute") { respond({ ok: execute(msg.action) }); return true; }
});
