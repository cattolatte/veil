/**
 * Screen capture and redaction, in the service worker.
 *
 * captureVisibleTab is a privileged API, so this cannot live in the content
 * script. The raw frame therefore exists only inside the extension's own
 * worker, never in the page and never on the wire.
 *
 * Order matters and is not negotiable: capture, evaluate, MASK, only then
 * serialise. The redacted frame is produced by drawing opaque rectangles onto
 * the bitmap, so the sensitive pixels are destroyed rather than merely
 * covered — a CSS overlay would still ship the original underneath.
 */
import { api } from "./lib/browser.js";
import { ScreenPerception } from "./vision/screen.js";

const screen = new ScreenPerception();

/** Capture the visible tab as an ImageBitmap. */
async function grabFrame() {
  const dataUrl = await api.tabs.captureVisibleTab(undefined, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

/**
 * Capture, evaluate, redact.
 *
 * @returns {Promise<{redactedPng:string, regions:Array, stats:object}>}
 */
export async function captureAndRedact({ quality = 0.8, maxWidth = 1280 } = {}) {
  const t0 = performance.now();
  const bitmap = await grabFrame();
  const tCap = performance.now();

  const page = { width: bitmap.width, height: bitmap.height };
  const { regions, ms, backend } = await screen.evaluate(bitmap, page);
  const tEval = performance.now();

  // Downscale for transport, preserving aspect ratio.
  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);

  // Destroy the pixels. Opaque fill, not blur: a blur of large text is often
  // still legible, and this frame is about to leave the machine.
  ctx.fillStyle = "#000";
  for (const r of regions) {
    ctx.fillRect(Math.round(r.x * scale), Math.round(r.y * scale),
                 Math.round(r.w * scale), Math.round(r.h * scale));
  }
  bitmap.close?.();

  const blob = await canvas.convertToBlob({ type: "image/webp", quality });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);

  const maskedPx = regions.reduce((a, r) => a + r.w * r.h, 0);
  return {
    redactedPng: `data:image/webp;base64,${btoa(bin)}`,
    regions,
    stats: {
      backend,
      regionsMasked: regions.length,
      screenMaskedPct: +(100 * maskedPx / (page.width * page.height)).toFixed(1),
      captureMs: +(tCap - t0).toFixed(1),
      inferenceMs: ms,
      totalMs: +(performance.now() - t0).toFixed(1),
      bytes: buf.length,
    },
  };
}
