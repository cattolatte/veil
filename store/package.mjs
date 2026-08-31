/**
 * Build a store-ready zip.
 *
 * Only what the extension needs at runtime goes in — no source, no tests, no
 * training code. A store package containing the training pipeline would be
 * both larger and more revealing than it needs to be.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv[2] === "firefox" ? "firefox" : "chrome";
const manifest = target === "firefox" ? "manifest.firefox.json" : "manifest.json";

if (!existsSync("extension/dist/content.js")) {
  console.error("run `npm run build` first — dist/ is generated, not committed");
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), "veil-pkg-"));
for (const dir of ["dist", "popup", "models", "vendor"]) {
  cpSync(join("extension", dir), join(stage, dir), { recursive: true });
}
writeFileSync(join(stage, "manifest.json"), readFileSync(join("extension", manifest)));

const out = `store/veil-${target}.zip`;
rmSync(out, { force: true });
execFileSync("zip", ["-qr", join(process.cwd(), out), "."], { cwd: stage });
rmSync(stage, { recursive: true, force: true });

const mb = (readFileSync(out).length / 1e6).toFixed(1);
console.log(`${out}  (${mb} MB)`);
console.log(`manifest: ${manifest}`);
