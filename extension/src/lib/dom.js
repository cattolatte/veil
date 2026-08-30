/**
 * Shared DOM constants and helpers.
 *
 * INTERACTIVE lives here because two modules must agree on it exactly:
 * serialize.js assigns each element an index from this NodeList, and
 * content.js resolves an action back with the same query. If the two
 * definitions ever drift, every index shifts and the agent clicks the wrong
 * control - silently, and only on pages where the mismatch bites.
 */

export const INTERACTIVE =
  "a,button,input,select,textarea,[role=button],[role=link],[role=textbox],[contenteditable=true]";

export const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "HEAD"]);

/** The single query both modules index against. */
export function interactiveElements(root = document) {
  return root.querySelectorAll(INTERACTIVE);
}

/**
 * Viewport size, with fallbacks.
 *
 * `innerWidth`/`innerHeight` report 0 in hidden tabs, offscreen renders, some
 * headless contexts, and early in document load. Returns null when no
 * trustworthy size is available.
 */
export function viewportSize() {
  // Read every global off globalThis. `visualViewport?.width` looks safe but
  // optional chaining does NOT guard an UNDECLARED binding - it throws
  // ReferenceError, which would abort the whole scan and redact nothing.
  const vv = globalThis.visualViewport;
  const doc = globalThis.document;
  const cands = [
    [globalThis.innerWidth, globalThis.innerHeight],
    [vv?.width, vv?.height],
    [doc?.documentElement?.clientWidth, doc?.documentElement?.clientHeight],
    [doc?.body?.clientWidth, doc?.body?.clientHeight],
  ];
  for (const [w, h] of cands) if (w > 0 && h > 0) return { w, h };
  return null;
}

const HAS_CHECK_VISIBILITY = typeof Element.prototype.checkVisibility === "function";

/**
 * Visibility test. Returns the element's rect on success so callers do not
 * measure it a second time - getBoundingClientRect forces layout, and this
 * runs on every interactive element on the page.
 *
 * Prefers Element.checkVisibility(), which the engine answers from internal
 * state, over getComputedStyle(), which is markedly more expensive.
 */
export function visibleRect(el, vp) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  // Cull offscreen elements ONLY when the viewport size is known. With an
  // unknown viewport this test rejects everything, the scan returns nothing,
  // and nothing is marked sensitive - it would fail OPEN. Scanning extra
  // offscreen elements is merely wasteful; missing them is a privacy failure.
  if (vp && (r.bottom < 0 || r.top > vp.h || r.right < 0 || r.left > vp.w)) return null;

  if (HAS_CHECK_VISIBILITY) {
    if (!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) {
      return null;
    }
    return r;
  }
  const s = getComputedStyle(el);
  if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return null;
  return r;
}

/** Round a DOMRect to integer CSS pixels. */
export function boxOf(r) {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}
