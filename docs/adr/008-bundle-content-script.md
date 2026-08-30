# ADR-008 — Bundle the content script to a classic IIFE

**Status:** Accepted · **Date:** 2026-08-30

## Context

The content script was written as ES modules importing `pii.js`, `redact.js`
and `serialize.js`. It never ran.

**MV3 content scripts declared in the manifest are classic scripts.** They
cannot use ES module `import`, so the file failed at parse time in both Chrome
and Firefox. Nothing downstream — latency, resource use, the vision pass — was
measurable until this was fixed.

## Decision

Bundle `content.js` to a single IIFE with esbuild (`npm run build`). The
service worker is exempt: MV3 supports `"type": "module"` there.

ONNX Runtime assets (66 MB) are staged from `node_modules` by the same build
rather than committed. All three wasm variants ship because ORT selects one at
runtime by capability.

## Consequences

The extension runs. A build step is now mandatory before loading unpacked,
which is documented in the README.

The bundler also became a correctness check — it caught a name collision
(`budget` used for both the phase timer and the text-character budget) that the
unbundled setup would have shipped silently.

Cost: `extension/dist/` and `extension/vendor/` are gitignored, so a fresh
clone requires `npm install && npm run build` before the extension will load.
