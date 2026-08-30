/**
 * The five privacy invariants from docs/THREAT_MODEL.md.
 *
 * These are the tests that matter. Everything else measures quality; these
 * decide whether the system is safe. Invariants 3 and 4 were previously
 * verified only by inspection, which is how three fail-open defects reached
 * main.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage, leaks, SECRETS } from "./helpers.mjs";

const PAGE = `
  <h1>Northwind Bank</h1>
  <p>Account holder: Ramesh Kumar</p>
  <p>Aadhaar <span><em>2341</em><em>23412346</em></span> &middot; PAN ABCPE1234K &middot; IFSC HDFC0001234</p>
  <p>Email ramesh.kumar@example.org, mobile 9845012345</p>
  <p>Reference ORDER-100000000000 and ticket 1234 5678 9012</p>
  <form>
    <label>Issue <input id="issue" name="issue" placeholder="What went wrong?"></label>
    <label>Password <input type="password" id="pw" value="hunter2"></label>
    <label>Card <input autocomplete="cc-number" id="cc" value="4539578763621486"></label>
  </form>
  <img id="photo" src="p.jpg" alt="staff photo">
  <button id="go">Submit</button>`;

async function build(opts) {
  mountPage(PAGE);
  const { buildContext } = await import("../extension/src/lib/serialize.js?" + Math.random());
  return buildContext(opts);
}

test("INVARIANT 1 — no form field value is ever transmitted", async () => {
  const ctx = await build();
  assert.deepEqual(leaks(ctx), [], "payload contained a secret");

  const pw = ctx.elements.find((e) => e.sensitive === "password");
  assert.ok(pw, "password field must be classified");
  assert.deepEqual(Object.keys(pw.state).sort(), ["filled", "length"],
    "only presence and length may be reported");
  assert.equal(pw.state.filled, true);
});

test("INVARIANT 2 — every verified PII span is replaced before transmit", async () => {
  const ctx = await build();
  for (const secret of ["234123412346", "ABCPE1234K", "HDFC0001234",
                        "ramesh.kumar@example.org", "9845012345"]) {
    assert.ok(!ctx.text.includes(secret), `${secret} survived redaction`);
  }
  for (const ph of ["[[AADHAAR]]", "[[PAN]]", "[[IFSC]]", "[[EMAIL]]", "[[PHONE]]"]) {
    assert.ok(ctx.text.includes(ph), `${ph} missing — value was dropped, not replaced`);
  }
  // Decoys must survive: over-redaction costs the precision metric.
  assert.ok(ctx.text.includes("ORDER-100000000000"), "decoy was wrongly redacted");
});

test("INVARIANT 3 — an unscanned visual region is marked for redaction", async () => {
  mountPage(PAGE);
  const { VisionEngine } = await import("../extension/src/vision/engine.js?" + Math.random());
  const eng = new VisionEngine();
  const candidates = [{ tag: "img", box: { x: 0, y: 0, w: 300, h: 300 }, alt: "" }];

  // No ONNX runtime in this environment, so init fails — the fail-closed path.
  const regions = await eng.findSensitiveRegions(candidates);
  assert.equal(regions.length, 1, "candidate must not be silently dropped");
  assert.equal(regions[0].kind, "unscanned");
  assert.equal(regions[0].severity, 3, "unscanned imagery must carry maximum severity");
});

test("INVARIANT 4 — detection failures increase redaction, never decrease it", async () => {
  // 4a. Unknown viewport must not silently empty the scan.
  mountPage(PAGE);
  // Simulate every viewport source reporting nothing — a hidden tab, an
  // offscreen render, or very early document load.
  globalThis.innerWidth = 0;
  globalThis.innerHeight = 0;
  Object.defineProperty(globalThis, "visualViewport", { value: undefined, configurable: true });
  for (const el of [globalThis.document.documentElement, globalThis.document.body]) {
    for (const prop of ["clientWidth", "clientHeight"]) {
      Object.defineProperty(el, prop, { value: 0, configurable: true });
    }
  }
  const { buildContext } = await import("../extension/src/lib/serialize.js?" + Math.random());
  const ctx = await buildContext();
  assert.ok(ctx.stats.scanned > 0, "unknown viewport must not zero the element scan");
  assert.ok(ctx.elements.some((e) => e.sensitive === "password"),
    "password must still be classified with no viewport");
  assert.deepEqual(leaks(ctx), []);

  // 4b. A tight element budget must not leave sensitive elements unclassified.
  mountPage(PAGE);
  const { buildContext: bc2 } = await import("../extension/src/lib/serialize.js?" + Math.random());
  const tiny = await bc2({ maxElements: 1 });
  const sensitive = tiny.elements.filter((e) => e.sensitive);
  assert.ok(sensitive.length >= 2,
    `budget of 1 dropped sensitive elements: found ${sensitive.length}`);
  assert.deepEqual(leaks(tiny), []);
});

test("INVARIANT 5 — the transmitted URL carries no query string", async () => {
  const ctx = await build();
  assert.ok(!ctx.url.includes("?"), `query string transmitted: ${ctx.url}`);
  assert.ok(!ctx.url.includes("SHOULD_NOT_LEAK"));
});

test("canvas masking fails closed on a tainted canvas", async () => {
  const { maskCanvas } = await import("../extension/src/lib/redact.js?" + Math.random());
  const painted = [];
  const ctx2d = {
    set fillStyle(v) { this._f = v; },
    get fillStyle() { return this._f; },
    fillRect: (x, y, w, h) => painted.push({ x, y, w, h }),
    getImageData() { throw new Error("SecurityError: tainted canvas"); },
  };
  maskCanvas(ctx2d, [{ x: 5, y: 5, w: 50, h: 50, mode: "blur", kind: "face" }]);
  assert.equal(painted.length, 1, "a tainted canvas must still be masked");
  assert.deepEqual(painted[0], { x: 5, y: 5, w: 50, h: 50 });
});

test("a PII match straddling a block boundary is redacted, not dropped", async () => {
  // Labels and values sit in sibling blocks, so the scanner prepends the
  // previous block's tail as context. A match that begins in that prefix and
  // ends inside the block must still be masked: discarding it would leave the
  // tail in the clear, which is a fail-open.
  const { scanText } = await import("../extension/src/lib/pii.js");
  const { redactText } = await import("../extension/src/lib/redact.js");

  const prefix = "Aadhaar 2341 2341 ";
  const raw = "2346 reference";
  const spans = scanText(prefix + raw)
    .filter((s) => s.end > prefix.length)
    .map((s) => ({ ...s, start: Math.max(0, s.start - prefix.length), end: s.end - prefix.length }));

  const { text } = redactText(raw, spans);
  assert.ok(!text.includes("2346"), `straddling tail survived redaction: ${text}`);
  assert.ok(text.includes("[[AADHAAR]]"));
});
