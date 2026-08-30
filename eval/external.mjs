/**
 * Scores the detector against an EXTERNAL corpus (ai4privacy/pii-masking-300k),
 * not our own generator.
 *
 * This is the number that matters when someone asks "on what data?". Our own
 * synthetic set can only tell us we did not regress; it cannot tell us the
 * detector generalises, because we wrote both the data and the detector.
 *
 * Only labels this detector actually targets are scored. Counting DRIVERLICENSE
 * or PASSPORT as misses would be dishonest in the other direction - we never
 * claimed to detect them.
 *
 *   node eval/external.mjs datagen/external/pii300k-en.jsonl
 */
import { readFileSync } from "node:fs";
import { scanText } from "../extension/src/lib/pii.js";

// Their label -> our kind. Unmapped labels are out of scope, not failures.
const MAP = {
  EMAIL: "email", TEL: "phone_in", BOD: "dob", DATE: "dob",
  // Numeric government / account identifiers. PASSPORT is included even though
  // many are alphanumeric and out of reach of a digits-only pattern - excluding
  // it would flatter the recall figure.
  DRIVERLICENSE: "id_number", SOCIALNUMBER: "id_number",
  IDCARD: "id_number", PASSPORT: "id_number",
};
const SCORED = new Set(Object.values(MAP));

const path = process.argv[2] ?? "datagen/external/pii300k-en.jsonl";
const rows = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const norm = (v) => (v || "").replace(/[^a-zA-Z0-9@.]/g, "").toLowerCase();
const tp = {}, fp = {}, fn = {};
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);

let t0 = performance.now();
for (const row of rows) {
  const gold = [];
  for (const s of row.spans) {
    const kind = MAP[s.label];
    if (kind) gold.push({ kind, value: s.value });
  }
  const got = scanText(row.text).map((s) => ({ kind: s.kind, value: row.text.slice(s.start, s.end) }));

  const pool = new Map();
  for (const g of got) {
    if (!SCORED.has(g.kind)) continue;             // out-of-scope kinds are ignored
    const k = `${g.kind}|${norm(g.value)}`;
    pool.set(k, (pool.get(k) || 0) + 1);
  }
  for (const g of gold) {
    const k = `${g.kind}|${norm(g.value)}`;
    if (pool.get(k) > 0) { pool.set(k, pool.get(k) - 1); bump(tp, g.kind); }
    else bump(fn, g.kind);
  }
  for (const [k, n] of pool) if (n > 0) bump(fp, k.split("|")[0], n);
}
const ms = performance.now() - t0;

const kinds = [...new Set([...Object.keys(tp), ...Object.keys(fp), ...Object.keys(fn)])].sort();
console.log(`\nExternal corpus: ${path}`);
console.log(`${rows.length} documents, ${ms.toFixed(0)} ms (${(ms / rows.length).toFixed(2)} ms/doc)\n`);
console.log(`  ${"kind".padEnd(10)}${"tp".padStart(7)}${"fp".padStart(7)}${"fn".padStart(7)}${"prec".padStart(9)}${"recall".padStart(9)}${"F1".padStart(9)}`);
console.log(`  ${"-".repeat(48)}`);
let TP = 0, FP = 0, FN = 0;
for (const k of kinds) {
  const a = tp[k] || 0, b = fp[k] || 0, c = fn[k] || 0;
  TP += a; FP += b; FN += c;
  const p = a + b ? a / (a + b) : 0, r = a + c ? a / (a + c) : 0;
  const f = p + r ? (2 * p * r) / (p + r) : 0;
  console.log(`  ${k.padEnd(10)}${String(a).padStart(7)}${String(b).padStart(7)}${String(c).padStart(7)}${(p * 100).toFixed(1).padStart(8)}%${(r * 100).toFixed(1).padStart(8)}%${(f * 100).toFixed(1).padStart(8)}%`);
}
const P = TP + FP ? TP / (TP + FP) : 0, R = TP + FN ? TP / (TP + FN) : 0;
console.log(`  ${"-".repeat(48)}`);
console.log(`  overall   precision ${(P * 100).toFixed(1)}%   recall ${(R * 100).toFixed(1)}%   F1 ${((2 * P * R) / (P + R) * 100).toFixed(1)}%`);
