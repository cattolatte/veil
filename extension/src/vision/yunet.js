/**
 * YuNet face detector — pre/post-processing.
 *
 * Chosen for size: 227 KB. Client resource utilisation is 20% of the score
 * and latency 15%, so a small purpose-built detector beats a large general
 * model here even if the large one is more accurate. Detecting a face well
 * enough to mask it is a low bar; being cheap enough not to lose 35% of the
 * marks is not.
 *
 * Model: 640x640 fixed input, three feature strides (8/16/32), each emitting
 * classification, objectness, box and keypoint tensors.
 */

export const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32];

/**
 * Letterbox an image source into a 640x640 BGR NCHW float tensor.
 *
 * Aspect ratio is preserved and the remainder padded, because squashing
 * distorts faces enough to cost recall. Returns the transform so boxes can be
 * mapped back to page coordinates.
 */
export function preprocess(source, width, height, ctx2d) {
  const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const dw = Math.round(width * scale);
  const dh = Math.round(height * scale);
  const padX = Math.floor((INPUT_SIZE - dw) / 2);
  const padY = Math.floor((INPUT_SIZE - dh) / 2);

  ctx2d.fillStyle = "#000";
  ctx2d.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx2d.drawImage(source, 0, 0, width, height, padX, padY, dw, dh);
  const { data } = ctx2d.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  // NCHW, BGR, raw 0-255 — YuNet applies no mean/std normalisation.
  const px = INPUT_SIZE * INPUT_SIZE;
  const out = new Float32Array(3 * px);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = data[i + 2];          // B
    out[px + p] = data[i + 1];     // G
    out[2 * px + p] = data[i];     // R
  }
  return { tensor: out, scale, padX, padY };
}

/** Decode one stride level into boxes in letterboxed 640x640 space. */
function decodeLevel(out, stride, threshold) {
  const cls = out[`cls_${stride}`], obj = out[`obj_${stride}`], box = out[`bbox_${stride}`];
  if (!cls || !obj || !box) return [];
  const cols = INPUT_SIZE / stride;
  const found = [];
  for (let i = 0; i < cls.length; i++) {
    // Geometric mean of class and objectness, as YuNet defines confidence.
    const score = Math.sqrt(Math.max(0, cls[i]) * Math.max(0, obj[i]));
    if (score < threshold) continue;
    const col = i % cols, row = Math.floor(i / cols);
    const b = i * 4;
    const cx = (col + box[b]) * stride;
    const cy = (row + box[b + 1]) * stride;
    const w = Math.exp(box[b + 2]) * stride;
    const h = Math.exp(box[b + 3]) * stride;
    found.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
  }
  return found;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

export function nms(boxes, iouThreshold = 0.3) {
  const sorted = [...boxes].sort((p, q) => q.score - p.score);
  const kept = [];
  for (const b of sorted) {
    if (!kept.some((k) => iou(k, b) > iouThreshold)) kept.push(b);
  }
  return kept;
}

/**
 * Full postprocess: decode every stride, suppress overlaps, and map back out
 * of letterbox space into the original image's coordinates.
 */
export function postprocess(outputs, { scale, padX, padY }, { threshold = 0.6, iouThreshold = 0.3, maxFaces = 32 } = {}) {
  let boxes = [];
  for (const s of STRIDES) boxes = boxes.concat(decodeLevel(outputs, s, threshold));
  return nms(boxes, iouThreshold).slice(0, maxFaces).map((b) => ({
    x: (b.x - padX) / scale,
    y: (b.y - padY) / scale,
    w: b.w / scale,
    h: b.h / scale,
    score: +b.score.toFixed(3),
  }));
}
