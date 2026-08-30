/**
 * Bundles the content script.
 *
 * MV3 content scripts declared in the manifest are CLASSIC scripts — they
 * cannot use ES module `import`. Loading src/content.js directly fails at
 * parse time in both Chrome and Firefox. So it is bundled to a single IIFE.
 *
 * The service worker is exempt: MV3 supports `"type": "module"` there, and
 * background.js is copied as-is.
 */
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const OUT = "extension/dist";

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const config = {
  entryPoints: ["extension/src/content.js"],
  bundle: true,
  format: "iife",          // classic script — the whole point of this build
  target: ["chrome110", "firefox121"],
  outfile: `${OUT}/content.js`,
  logLevel: "info",
  legalComments: "none",
};

// Exposed for testing: lets the bundle be injected into a plain page and
// driven directly, without the extension runtime.
const testConfig = {
  ...config,
  entryPoints: ["extension/src/lib/serialize.js"],
  format: "iife",
  globalName: "VeilTest",
  outfile: `${OUT}/veil-test.js`,
};

if (watch) {
  const ctxs = await Promise.all([esbuild.context(config), esbuild.context(testConfig)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("watching…");
} else {
  await Promise.all([esbuild.build(config), esbuild.build(testConfig)]);
  await cp("extension/src/background.js", `${OUT}/background.js`);
  console.log(`built -> ${OUT}`);
}
