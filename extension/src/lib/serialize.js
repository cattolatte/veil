/**
 * Builds the sanitised context object sent to the server.
 *
 * Design rule: the server receives STRUCTURE, never CONTENT. It learns that
 * there is a password field at index 4 and that it is empty; it never learns
 * the password, the label text if that text was sensitive, or the pixels.
 */

import { classifyElement, scanText, Severity } from "./pii.js";
import { redactText, describeFieldState, placeholderFor } from "./redact.js";
import { Budget } from "./perf.js";
import { INTERACTIVE, SKIP_TAGS, interactiveElements, viewportSize, visibleRect, boxOf } from "./dom.js";

const INLINE_TAGS = new Set([
  "A","ABBR","B","BDI","BDO","CITE","CODE","DATA","DFN","EM","I","KBD","MARK",
  "Q","RP","RT","RUBY","S","SAMP","SMALL","SPAN","STRONG","SUB","SUP","TIME",
  "U","VAR","WBR","LABEL","FONT","INS","DEL",
]);

/** Nearest block-level ancestor, used to group text fragments for scanning. */
function blockAncestor(el) {
  let cur = el;
  while (cur && cur !== document.body && INLINE_TAGS.has(cur.tagName)) {
    cur = cur.parentElement;
  }
  return cur || document.body;
}

/** Redact a user-visible label before it is used as an element's description. */
function safeLabel(raw) {
  const t = (raw || "").trim().slice(0, 120);
  if (!t) return "";
  const spans = scanText(t);
  return spans.length ? redactText(t, spans).text : t;
}

export function buildContext({ maxElements = 120, retainRawText = false } = {}) {
  const budget = new Budget();
  const vp = viewportSize();
  const stats = { scanned: 0, redactedElements: 0, redactedSpans: 0, byKind: {} };
  const bump = (k, n = 1) => { stats.byKind[k] = (stats.byKind[k] || 0) + n; };

  const elements = [];
  const visualCandidates = [];

  // Every interactive element is classified. Only the NON-sensitive descriptors
  // are capped: breaking out of the loop at maxElements would leave sensitive
  // elements later in a long document unclassified and therefore unredacted -
  // fail-open again. Budget is spent on safety first, description second.
  // `i` must be the index into this exact NodeList: content.js resolves an
  // action back with querySelectorAll(INTERACTIVE)[action.index]. Using a
  // count of visible elements instead would shift every index and click the
  // wrong control.
  const all = interactiveElements();
  for (let idx = 0; idx < all.length; idx++) {
    const el = all[idx];
    if (SKIP_TAGS.has(el.tagName)) continue;
    // visibleRect returns the measured rect, so it is not measured again below.
    const r = visibleRect(el, vp);
    if (!r) continue;
    stats.scanned++;

    const cls = classifyElement(el);
    const isSensitive = cls && cls.kind !== "visual_candidate";
    if (!isSensitive && elements.length >= maxElements) {
      stats.truncated = (stats.truncated || 0) + 1;
      continue;
    }
    const entry = {
      i: idx,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || null,
      role: el.getAttribute("role") || null,
      label: safeLabel(el.getAttribute("aria-label") || el.placeholder || el.innerText || el.value && "" || ""),
      box: boxOf(r),
    };

    if (isSensitive) {
      entry.sensitive = cls.kind;
      entry.placeholder = placeholderFor(cls.kind);
      if (el.tagName === "INPUT") entry.state = describeFieldState(el);
      stats.redactedElements++;
      bump(cls.kind);
    } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      entry.state = describeFieldState(el);
    }
    elements.push(entry);
  }

  budget.mark("elements");

  // Images and canvases are handed to the vision pass rather than described,
  // since only pixels can tell whether a face is present.
  for (const el of document.querySelectorAll("img,video,canvas")) {
    const r = visibleRect(el, vp);
    if (!r) continue;
    // `el` is a live node reference for the vision pass. It never leaves the
    // client: content.js deletes visualCandidates before serialising, and
    // JSON.stringify could not encode it anyway. Carrying it beats recovering
    // the element with elementFromPoint, which picks the wrong node whenever
    // something overlaps and shifts with scroll.
    visualCandidates.push({ el, tag: el.tagName.toLowerCase(), box: boxOf(r), alt: safeLabel(el.getAttribute("alt")) });
  }

  budget.mark("visualCandidates");

  // Page text, grouped by block ancestor, then redacted span-wise.
  //
  // Scanning each text node in isolation misses PII split across inline
  // elements - `<span><em>2341</em><em>23412346</em></span>` yields two nodes,
  // neither of which matches. Measured cost of the naive approach: half the
  // recall on affected instances. Grouping by nearest block-level ancestor
  // rejoins inline fragments while still keeping unrelated blocks apart, so
  // adjacent-but-unrelated numbers do not fuse into a false match.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const groups = new Map();
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) continue;
    // NOT trimmed. Text node values already carry the real whitespace, so
    // joining them with "" reproduces exactly what the page renders. Trimming
    // and re-joining with " " inserts a separator that was never on screen:
    // <em>2341</em><em>23412346</em> became "2341 23412346", which is not a
    // valid Aadhaar shape and silently stopped matching. Found by the demo.
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) continue;
    const block = blockAncestor(parent);
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block).push(raw);
  }

  const chunks = [];
  const rawChunks = [];
  let textBudget = 8000;
  // Tail of the previous block, used ONLY as lookbehind context.
  //
  // Labels and values usually live in sibling blocks — `<div>Aadhaar</div>
  // <div>2341 2341 2346</div>` in a table row, definition list or form layout.
  // Scanning each block in isolation means the label is invisible to patterns
  // that require corroborating context (ADR-006), so a labelled Aadhaar right
  // next to the word "Aadhaar" went undetected. Found by the demo page.
  //
  // The prefix is prepended for matching and then subtracted back out, so it
  // supplies context without letting values from separate blocks fuse into a
  // single false match.
  let prevTail = "";
  for (const parts of groups.values()) {
    if (textBudget <= 0) break;
    // "" because the node values carry their own whitespace; then collapse
    // runs so a single logical space never reads as several.
    const raw = parts.join("").replace(/\s+/g, " ").trim();
    if (raw.length < 3) { prevTail = raw; continue; }
    // Separator matters: gluing the label directly onto the value destroys the
    // \b word boundary the patterns rely on.
    const prefix = prevTail ? prevTail.slice(-48) + " " : "";
    // A match can straddle the boundary — begin in the prefix and end inside
    // this block. Discarding those would leave the tail transmitted in the
    // clear, so they are CLAMPED into range instead: the overlapping portion
    // is still redacted. Fail closed (ADR-003).
    const spans = scanText(prefix + raw)
      .filter((s) => s.end > prefix.length)
      .map((s) => ({ ...s, start: Math.max(0, s.start - prefix.length), end: s.end - prefix.length }));
    prevTail = raw;
    if (spans.length) {
      stats.redactedSpans += spans.length;
      for (const s of spans) bump(s.kind);
    }
    const { text } = redactText(raw, spans);
    chunks.push(text);
    // Raw block text AND the pattern spans already found in it, retained only
    // when the neural pass will run. The neural pass must redact BOTH sets from
    // the raw text in one go: rebuilding from raw with only its own spans would
    // silently discard every pattern redaction.
    if (retainRawText) rawChunks.push({ raw, spans });
    textBudget -= text.length;
  }

  budget.mark("text");
  const cost = budget.finish();

  const ctx = {
    schema: "veil/1",
    url: location.origin + location.pathname,   // query string dropped: it carries PII
    title: safeLabel(document.title),
    viewport: { w: vp?.w ?? null, h: vp?.h ?? null, dpr: devicePixelRatio, culled: !!vp },
    elements,
    visualCandidates,
    text: chunks.join(" ").slice(0, 8000),
    redactionScheme: "typed-placeholder/[[KIND]]",
    stats,
    cost,
    buildMs: cost.totalMs,
  };
  if (retainRawText) {
    // Non-enumerable, so JSON.stringify cannot pick it up even if the explicit
    // deletion in content.js were ever missed. Belt and braces on the path
    // that matters most.
    Object.defineProperty(ctx, "__rawChunks", {
      value: rawChunks, enumerable: false, configurable: true,
    });
  }
  return ctx;
}
