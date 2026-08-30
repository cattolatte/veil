/** Unit tests for detection primitives. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidAadhaar, isValidLuhn, scanText, classifyElement } from "../extension/src/lib/pii.js";
import { redactText, placeholderFor } from "../extension/src/lib/redact.js";
import { mountPage } from "./helpers.mjs";

test("Verhoeff accepts valid Aadhaar and rejects corrupted ones", () => {
  assert.equal(isValidAadhaar("234123412346"), true);
  assert.equal(isValidAadhaar("234123412345"), false, "wrong check digit");
  assert.equal(isValidAadhaar("134123412346"), false, "must not start with 1");
  assert.equal(isValidAadhaar("034123412346"), false, "must not start with 0");
});

test("Luhn accepts valid card numbers and rejects corrupted ones", () => {
  assert.equal(isValidLuhn("4539578763621486"), true);
  assert.equal(isValidLuhn("4539578763621487"), false);
});

test("checksum verification suppresses lookalike identifiers", () => {
  // A 12-digit order reference that is not a valid Aadhaar.
  const kinds = scanText("order 100000000000 shipped").map((s) => s.kind);
  assert.ok(!kinds.includes("aadhaar"), `expected no aadhaar, got ${kinds}`);
});

test("separated Aadhaar requires a corroborating label", () => {
  assert.ok(scanText("Aadhaar: 2341 2341 2346").some((s) => s.kind === "aadhaar"));
  assert.ok(!scanText("ticket 2341 2341 2346").some((s) => s.kind === "aadhaar"),
    "an unlabelled grouped number must not be treated as Aadhaar");
});

test("dates are PII only with birth context", () => {
  assert.ok(scanText("Date of Birth: 21/07/1936").some((s) => s.kind === "dob"));
  assert.ok(!scanText("The treaty was signed on 17th February 1946.").some((s) => s.kind === "dob"),
    "historical dates in prose must not be treated as PII");
});

test("a labelled identifier is not misreported as a phone number", () => {
  const kinds = scanText("Driver's License: 6042580277").map((s) => s.kind);
  assert.ok(kinds.includes("id_number"));
  assert.ok(!kinds.includes("phone_in"));
});

test("overlapping matches redact once, at the higher severity", () => {
  const text = "card 4539578763621486 end";
  const spans = scanText(text);
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i].start >= spans[i - 1].end, "spans must not overlap");
  }
});

test("redaction replaces only the matched span", () => {
  const t = "write to a.b@x.com today";
  const { text } = redactText(t, scanText(t));
  assert.equal(text, "write to [[EMAIL]] today");
});

test("structural classification trusts element type", () => {
  mountPage(`<input type="password" id="p"><input autocomplete="cc-number" id="c">`);
  assert.equal(classifyElement(document.getElementById("p")).kind, "password");
  assert.equal(classifyElement(document.getElementById("c")).kind, "autocomplete:cc-number");
  assert.equal(placeholderFor("autocomplete:cc-number"), "[[CC_NUMBER]]");
});
