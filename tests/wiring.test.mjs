/**
 * Structural tests: is the pipeline actually connected?
 *
 * The screen perception model was trained, exported, benchmarked at 90.1% F1 on
 * 910 held-out real pages — and left unimported for two milestones. Every unit
 * test passed the whole time, because every unit worked. Nothing asserted that
 * the units were joined together.
 *
 * These tests assert the wiring itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bg = readFileSync("extension/src/background.js", "utf8");

test("background imports the screen capture pipeline", () => {
  assert.match(bg, /from "\.\/screen-capture\.js"/,
    "screen-capture.js must be imported, not merely present in the tree");
  assert.match(bg, /captureAndRedact\(/, "captureAndRedact must actually be called");
});

test("background applies DOM–vision fusion", () => {
  assert.match(bg, /from "\.\/vision\/fuse\.js"/, "fuse.js must be imported");
  assert.match(bg, /fuse\(/, "fuse must actually be called");
});

test("the redacted screenshot — not a raw one — is what gets sent", () => {
  assert.match(bg, /screenshot = shot\.redactedPng/,
    "only the redacted frame may be assigned for transmission");
  assert.ok(!/screenshot\s*=\s*(dataUrl|raw|bitmap)/.test(bg),
    "a raw frame must never be assigned to the transmitted variable");
  assert.match(bg, /body: JSON\.stringify\(\{[^}]*screenshot[^}]*\}\)/,
    "the screenshot must be included in the request body");
});

test("a failing screen pass does not send a screenshot", () => {
  // The catch block must leave `screenshot` null rather than falling through
  // with a partially-processed frame.
  const catchBlock = bg.slice(bg.indexOf("} catch (err) {"), bg.indexOf("const tScreen"));
  assert.ok(!/screenshot\s*=/.test(catchBlock),
    "the error path must not assign a screenshot");
});

test("every content-script module reachable from an entry point is imported", () => {
  const content = readFileSync("extension/src/content.js", "utf8");
  const all = bg + content;
  for (const mod of ["lib/serialize.js", "lib/redact.js", "lib/dom.js",
                     "vision/engine.js", "vision/fuse.js", "screen-capture.js"]) {
    assert.ok(all.includes(mod), `${mod} is written but never imported`);
  }
});

test("content script runs the neural pass and deletes the raw text", () => {
  const content = readFileSync("extension/src/content.js", "utf8");
  assert.match(content, /from "\.\/vision\/tagger\.js"/, "tagger must be imported");
  assert.match(content, /applyNeuralPass\(/, "neural pass must be called");
  assert.match(content, /delete context\.__rawChunks/,
    "raw text must be deleted before the context is returned");

  // The deletion must not sit inside the `if (neural)` block, or a thrown
  // error would skip it and leave the raw text attached.
  const idx = content.indexOf("delete context.__rawChunks");
  const before = content.slice(0, idx);
  const opens = (before.match(/if \(neural\) \{/g) || []).length;
  const closes = (before.match(/\n  \}/g) || []).length;
  assert.ok(opens <= closes, "deletion must be unconditional, outside the neural branch");
});

test("multi-step loop has a bound and a stall guard", () => {
  assert.match(bg, /MAX_STEPS/, "there must be a hard step ceiling");
  assert.match(bg, /stalled/, "a repeated action must terminate the loop");
  assert.match(bg, /stopReason/, "the caller must learn why the loop ended");
});
