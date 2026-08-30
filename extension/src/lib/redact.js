/**
 * Redaction.
 *
 * Rubric scores "precision of redaction" separately from detection, so the
 * goal is to remove exactly the sensitive span and nothing more. Blanking a
 * whole element because it contained one email costs precision.
 *
 * Redacted values are replaced by stable typed placeholders. The server is
 * told the scheme, so it can still reason about structure ("the form wants a
 * phone number here") without ever seeing the value.
 */

const PLACEHOLDER = {
  aadhaar: "[[AADHAAR]]", pan: "[[PAN]]", card: "[[CARD]]", ifsc: "[[IFSC]]",
  upi: "[[UPI]]", email: "[[EMAIL]]", phone_in: "[[PHONE]]", dob: "[[DOB]]",
  password: "[[PASSWORD]]", sensitive_field: "[[SENSITIVE]]", visual_candidate: "[[IMAGE]]",
};

export function placeholderFor(kind) {
  if (PLACEHOLDER[kind]) return PLACEHOLDER[kind];
  if (kind.startsWith("autocomplete:")) return `[[${kind.slice(13).toUpperCase().replace(/-/g, "_")}]]`;
  return "[[REDACTED]]";
}

/**
 * Apply span redactions to a string, right-to-left so earlier offsets stay
 * valid as the string is rewritten.
 */
export function redactText(text, spans) {
  if (!spans.length) return { text, count: 0 };
  let out = text;
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i];
    out = out.slice(0, s.start) + placeholderFor(s.kind) + out.slice(s.end);
  }
  return { text: out, count: spans.length };
}

/**
 * Value of a form field. Never transmitted — only whether it is filled, which
 * is what an agent actually needs to decide the next action.
 */
export function describeFieldState(el) {
  const v = el.value || "";
  return { filled: v.length > 0, length: v.length };
}

/**
 * Visual redaction boxes, in CSS pixels relative to the viewport, for regions
 * the vision pass marked sensitive (faces, rendered ID documents).
 * Consumed both by the canvas masker and by the debug overlay.
 */
export function boxesFromRegions(regions, dpr = 1) {
  return regions.map((r) => ({
    x: Math.round(r.x / dpr), y: Math.round(r.y / dpr),
    w: Math.round(r.w / dpr), h: Math.round(r.h / dpr),
    kind: r.kind, mode: r.severity >= 3 ? "blackout" : "blur",
  }));
}

function blackout(ctx, b) {
  ctx.fillStyle = "#000";
  ctx.fillRect(b.x, b.y, b.w, b.h);
}

/**
 * Destructively mask regions on a canvas before any pixels leave the client.
 *
 * Pixelation needs getImageData, which throws SecurityError on a canvas
 * tainted by cross-origin content — extremely common in the wild. An
 * unhandled throw here would abort the whole redaction pass and let the
 * frame through unmasked, so every failure path falls back to a blackout.
 * Degrade the picture, never the privacy.
 */
export function maskCanvas(ctx, boxes) {
  for (const b of boxes) {
    if (b.mode === "blackout") { blackout(ctx, b); continue; }
    try {
      // Cheap pixelation. Avoids a full blur pass, which costs latency —
      // and latency is 15% of the score.
      const img = ctx.getImageData(b.x, b.y, b.w, b.h);
      const block = 12;
      for (let y = 0; y < b.h; y += block) {
        for (let x = 0; x < b.w; x += block) {
          const i = ((y * b.w) + x) * 4;
          ctx.fillStyle = `rgb(${img.data[i]},${img.data[i + 1]},${img.data[i + 2]})`;
          // Clamp so the final row/column cannot paint outside the region.
          ctx.fillRect(b.x + x, b.y + y, Math.min(block, b.w - x), Math.min(block, b.h - y));
        }
      }
    } catch {
      blackout(ctx, b);
    }
  }
}
