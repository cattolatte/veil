/**
 * Bundles the content script.
 *
 * MV3 content scripts declared in the manifest are CLASSIC scripts — they
 * cannot use ES module `import`. Loading src/content.js directly fails at
 * parse time in both Chrome and Firefox. So it is bundled to a single IIFE.
 *
 * The service worker is bundled too. MV3 does support `"type": "module"`
 * there, so `import` is legal -- but only if what it imports is actually
 * present. background.js used to be copied on its own, which left three
 * relative imports pointing at files that live in src/ and were never copied.
 * Brave 404'd on dist/lib/browser.js, service worker registration failed with
 * status code 3, and with no background context the popup's message to the
 * content script never resolved: the UI sat on "Running..." forever, with
 * nothing in the page console and no request ever reaching the server.
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

// The popup imports the browser shim, so it needs bundling as well - a popup
// script with a bare import fails exactly like a content script does.
const popupConfig = {
  entryPoints: ["extension/popup/popup.js"],
  bundle: true,
  format: "iife",
  target: ["chrome110", "firefox121"],
  outfile: "extension/dist/popup.js",
  logLevel: "info",
  legalComments: "none",
};

// Bundled as ESM because the manifest declares `"type": "module"`. Bundling
// also means the import graph collapses into one file, so there is nothing
// left to 404 on.
const backgroundConfig = {
  entryPoints: ["extension/src/background.js"],
  bundle: true,
  format: "esm",
  target: ["chrome110", "firefox121"],
  outfile: `${OUT}/background.js`,
  logLevel: "info",
  legalComments: "none",
};

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
  const ctxs = await Promise.all([esbuild.context(config), esbuild.context(testConfig), esbuild.context(popupConfig), esbuild.context(backgroundConfig)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("watching…");
} else {
  await Promise.all([esbuild.build(config), esbuild.build(testConfig), esbuild.build(popupConfig), esbuild.build(backgroundConfig)]);

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
