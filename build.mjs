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

/**
 * ONNX Runtime assets are copied from node_modules rather than committed:
 * 65 MB of wasm has no business in git history. `npm run build` reproduces
 * them exactly.
 *
 * All three wasm variants ship because ORT picks one at runtime by capability
 * — the WebGPU build resolves the `asyncify` loader, and discovering that by
 * shipping only `jsep` cost an afternoon.
 */
const ORT_ASSETS = [
  "ort.webgpu.min.js",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

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
  entryPoints: ["eval/e2e-entry.js"],
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

  await mkdir("extension/vendor", { recursive: true });
  for (const f of ORT_ASSETS) {
    await cp(`node_modules/onnxruntime-web/dist/${f}`, `extension/vendor/${f}`).catch(() => {
      console.warn(`  ! missing ${f} — run npm install`);
    });
  }
  // The demo loads the same bundle. Copied on every build rather than
  // committed: a stale demo bundle would show behaviour the code no longer
  // has, which is the one failure mode a demo cannot survive.
  await cp(`${OUT}/veil-test.js`, "demo/veil-test.js");

  console.log(`built -> ${OUT}  (+ ${ORT_ASSETS.length} runtime assets, + demo bundle)`);
}
