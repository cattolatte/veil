/**
 * Runs the extension's own detector over generated pages and writes predictions.
 *
 * Two extraction modes, deliberately:
 *
 *   joined   - strip all tags, scan one concatenated string. Optimistic: PII
 *              split across inline elements gets silently rejoined.
 *   pernode  - scan each text node separately. The naive baseline.
 *   block    - group text fragments by their nearest block-level ancestor,
 *              which is what content.js now does. Rejoins inline fragments
 *              without fusing unrelated blocks.
 *
 * Reporting all three quantifies what the split-across-elements case costs and
 * what grouping recovers, instead of hiding it behind friendlier preprocessing.
 *
 *   node eval/detect.mjs datagen/out/manifest.jsonl eval/out/predictions.jsonl
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { scanText } from "../extension/src/lib/pii.js";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node eval/detect.mjs <manifest.jsonl> <predictions.jsonl>");
  process.exit(1);
}

const STRIP = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

const BLOCK_BREAK = /<\/?(?:p|div|li|tr|td|th|h[1-6]|section|article|header|footer|nav|aside|form|fieldset|table|ul|ol|dl|dt|dd|blockquote|pre|main|figure|figcaption|canvas|br)\b[^>]*>/gi;

/**
 * Text grouped by block boundary, mirroring blockAncestor() in serialize.js.
 * Inline tags are dropped so fragments rejoin; block tags split the stream.
 */
function textBlocks(html) {
  return html
    .replace(STRIP, "")
    .replace(BLOCK_BREAK, "\u0000")
    .split("\u0000")
    .map((seg) => seg.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim())
    .filter((seg) => seg.length >= 3);
}

/** Text nodes, in document order, mirroring the TreeWalker in content.js. */
function textNodes(html) {
  const body = html.replace(STRIP, "");
  const out = [];
  let depth = 0, buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "<") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      depth++;
    } else if (ch === ">") {
      depth--;
    } else if (depth <= 0) {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Attribute values that a DOM scan would also see (input value=, alt=, ...). */
function attrValues(html) {
  const out = [];
  for (const m of html.replace(STRIP, "").matchAll(/(?:value|alt|placeholder|aria-label)="([^"]*)"/gi)) {
    if (m[1].trim()) out.push(m[1].trim());
  }
  return out;
}

const lines = readFileSync(inPath, "utf8").trim().split("\n");
const preds = [];
let tJoined = 0, tPerNode = 0, tBlock = 0;

for (const line of lines) {
  const page = JSON.parse(line);
  const nodes = textNodes(page.html);
  const attrs = attrValues(page.html);

  // Emit the matched substring, not just the kind, so scoring can match each
  // prediction to the exact planted instance instead of guessing by count.
  const all = [...nodes, ...attrs].join(" ");
  let t0 = performance.now();
  const joined = scanText(all).map((s) => ({ kind: s.kind, text: all.slice(s.start, s.end) }));
  tJoined += performance.now() - t0;

  t0 = performance.now();
  const perNode = [];
  for (const chunk of [...nodes, ...attrs]) {
    for (const s of scanText(chunk)) perNode.push({ kind: s.kind, text: chunk.slice(s.start, s.end) });
  }
  tPerNode += performance.now() - t0;

  t0 = performance.now();
  const block = [];
  for (const chunk of [...textBlocks(page.html), ...attrs]) {
    for (const s of scanText(chunk)) block.push({ kind: s.kind, text: chunk.slice(s.start, s.end) });
  }
  tBlock += performance.now() - t0;

  preds.push({ id: page.id, joined, perNode, block });
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, preds.map((p) => JSON.stringify(p)).join("\n"), "utf8");
console.log(
  `scanned ${preds.length} pages -> ${outPath}\n` +
  `  joined  ${tJoined.toFixed(1)} ms total, ${(tJoined / preds.length).toFixed(2)} ms/page\n` +
  `  pernode ${tPerNode.toFixed(1)} ms total, ${(tPerNode / preds.length).toFixed(2)} ms/page\n` +
  `  block   ${tBlock.toFixed(1)} ms total, ${(tBlock / preds.length).toFixed(2)} ms/page`
);
