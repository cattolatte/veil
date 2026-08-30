/**
 * Shared ONNX Runtime loading.
 *
 * Both vision models need the same runtime, and ORT caches a failed init for
 * the page lifetime — so a second, independent attempt to load it would report
 * a stale error rather than retrying. One loader, one promise.
 */
let ortPromise = null;

/** Resolve a packaged asset in the extension, or relative when under test. */
export function assetUrl(path) {
  const rt = globalThis.chrome?.runtime ?? globalThis.browser?.runtime;
  return rt?.getURL ? rt.getURL(path) : path;
}

export async function loadOrt() {
  ortPromise ??= (async () => {
    if (globalThis.ort) return globalThis.ort;
    await import(/* webpackIgnore: true */ assetUrl("vendor/ort.webgpu.min.js"));
    const ort = globalThis.ort;
    if (!ort) throw new Error("onnxruntime not available");
    // Must be ABSOLUTE: ORT resolves the loader as a module specifier, and a
    // bare relative path throws before any backend initialises.
    ort.env.wasm.wasmPaths = new URL(assetUrl("vendor/"), location.href).href;
    ort.env.wasm.numThreads = 1;
    return ort;
  })();
  return ortPromise;
}
