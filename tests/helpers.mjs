/**
 * Test scaffolding: a JSDOM page with the globals serialize.js expects.
 *
 * The modules under test run in a page, so the DOM is real rather than mocked.
 * Mocking `document` would only prove the mock matches our assumptions, which
 * is precisely the failure mode that let three fail-open bugs through review.
 */
import { JSDOM } from "jsdom";

export function mountPage(html, { width = 1280, height = 900 } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    pretendToBeVisual: true,
    url: "https://example.test/account?token=SHOULD_NOT_LEAK",
  });
  const w = dom.window;

  // JSDOM performs no layout, so every rect is zero and the visibility test
  // would reject everything. Give elements a plausible box.
  w.Element.prototype.getBoundingClientRect = function () {
    const tag = this.tagName;
    const h = tag === "INPUT" || tag === "BUTTON" ? 28 : 20;
    return { x: 10, y: 10, width: 200, height: h, top: 10, left: 10, right: 210, bottom: 10 + h };
  };
  // jsdom's Performance delegates to the *global* performance, so copying it
  // onto globalThis makes now() call itself. Use a plain implementation.
  const clock = { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 };

  // `navigator` is a getter-only global in modern Node, so it is defined
  // rather than assigned. The vision engine reads `"gpu" in navigator`.
  for (const k of ["window", "document", "Element", "HTMLInputElement", "HTMLTextAreaElement",
                   "NodeFilter", "getComputedStyle", "visualViewport",
                   "innerWidth", "innerHeight", "devicePixelRatio", "location"]) {
    if (k in w) globalThis[k] = w[k];
  }
  try {
    Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
  } catch { /* already correct, or locked down — neither is fatal here */ }
  // Both are getter-only in their respective realms, so define rather than assign.
  for (const target of [globalThis, w]) {
    try { Object.defineProperty(target, "performance", { value: clock, configurable: true }); }
    catch { /* realm refuses redefinition; the module falls back to Date.now */ }
  }
  globalThis.innerWidth = width;
  globalThis.innerHeight = height;
  globalThis.devicePixelRatio = 1;
  return dom;
}

/** Every string that must never appear in a transmitted payload. */
export const SECRETS = [
  "hunter2", "correct-horse-staple",
  "234123412346", "2341 2341 2346",
  "4539578763621486",
  "ABCPE1234K", "HDFC0001234",
  "ramesh.kumar@example.org", "9845012345",
  "SHOULD_NOT_LEAK",
];

export function leaks(payload) {
  const blob = typeof payload === "string" ? payload : JSON.stringify(payload);
  return SECRETS.filter((s) => blob.includes(s));
}
