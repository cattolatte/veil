/**
 * Builds the sanitised context object sent to the server.
 *
 * Design rule: the server receives STRUCTURE, never CONTENT. It learns that
 * there is a password field at index 4 and that it is empty; it never learns
 * the password, the label text if that text was sensitive, or the pixels.
 */

import { classifyElement, scanText, Severity } from "./pii.js";
import { redactText, describeFieldState, placeholderFor } from "./redact.js";

const INTERACTIVE = "a,button,input,select,textarea,[role=button],[role=link],[role=textbox],[contenteditable=true]";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "HEAD"]);

/**
 * Viewport size, with fallbacks.
 *
 * `innerWidth`/`innerHeight` report 0 in several real situations: a background
 * or hidden tab, an offscreen render, some headless contexts, and very early in
 * document load. Returns null when no trustworthy size is available.
 */
function viewportSize() {
  const cands = [
    [window.innerWidth, window.innerHeight],
    [visualViewport?.width, visualViewport?.height],
    [document.documentElement?.clientWidth, document.documentElement?.clientHeight],
    [document.body?.clientWidth, document.body?.clientHeight],
  ];
  for (const [w, h] of cands) if (w > 0 && h > 0) return { w, h };
  return null;
}

function visible(el, vp) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  // Cull offscreen elements ONLY when the viewport size is known. With an
  // unknown viewport this test rejects everything, the element scan returns
  // nothing, and nothing is marked sensitive - the scan would fail OPEN.
  // Scanning extra offscreen elements is merely wasteful; missing them is a
  // privacy failure, so when in doubt, scan.
  if (vp && (r.bottom < 0 || r.top > vp.h || r.right < 0 || r.left > vp.w)) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
}

function rect(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/** Redact a user-visible label before it is used as an element's description. */
function safeLabel(raw) {
  const t = (raw || "").trim().slice(0, 120);
  if (!t) return "";
  const spans = scanText(t);
  return spans.length ? redactText(t, spans).text : t;
}

export function buildContext({ maxElements = 120 } = {}) {
  const t0 = performance.now();
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
  const all = document.querySelectorAll(INTERACTIVE);
  for (let idx = 0; idx < all.length; idx++) {
    const el = all[idx];
    if (SKIP_TAGS.has(el.tagName) || !visible(el, vp)) continue;
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
      box: rect(el),
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

  // Images and canvases are handed to the vision pass rather than described,
  // since only pixels can tell whether a face is present.
  for (const el of document.querySelectorAll("img,video,canvas")) {
    if (!visible(el, vp)) continue;
    visualCandidates.push({ tag: el.tagName.toLowerCase(), box: rect(el), alt: safeLabel(el.getAttribute("alt")) });
  }

  // Page text, redacted span-wise.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const chunks = [];
  let node, budget = 8000;
  while ((node = walker.nextNode()) && budget > 0) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName)) continue;
    const raw = node.nodeValue.trim();
    if (raw.length < 3) continue;
    const spans = scanText(raw);
    if (spans.length) {
      stats.redactedSpans += spans.length;
      for (const s of spans) bump(s.kind);
    }
    const { text } = redactText(raw, spans);
    chunks.push(text);
    budget -= text.length;
  }

  return {
    schema: "veil/1",
    url: location.origin + location.pathname,   // query string dropped: it carries PII
    title: safeLabel(document.title),
    viewport: { w: vp?.w ?? null, h: vp?.h ?? null, dpr: devicePixelRatio, culled: !!vp },
    elements,
    visualCandidates,
    text: chunks.join(" ").slice(0, 8000),
    redactionScheme: "typed-placeholder/[[KIND]]",
    stats,
    buildMs: +(performance.now() - t0).toFixed(1),
  };
}
