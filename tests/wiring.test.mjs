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
