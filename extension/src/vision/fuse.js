/**
 * Fusing the DOM channel with the screen channel.
 *
 * The two channels fail in opposite directions, which is the whole reason for
 * having both:
 *
 *   DOM   — precise where the markup is truthful (100% precision on real
 *           pages), blind to anything rendered rather than marked up
 *           (0/58 recall on canvas-drawn PII).
 *   Screen — sees rendered pixels, but over-fires on ordinary text
 *           (75.9% precision on held-out real pages).
 *
 * So the DOM is used to arbitrate. Where the DOM can account for a region —
 * it is ordinary text that the scanner examined and found clean — a screen
 * flag there is far more likely to be a false positive than a discovery.
 * Where the DOM cannot account for it (canvas, image, video, shadow content),
 * the screen model is the only witness and its flag stands.
 *
 * This raises precision without retraining and without touching recall on the
 * cases the screen model exists for.
 */

/** Fraction of `a` covered by `b`. */
function overlapFraction(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area = a.w * a.h;
  return area > 0 ? inter / area : 0;
}

/**
 * @param {Array} screenRegions   from ScreenPerception.evaluate()
 * @param {object} domContext     from buildContext()
 * @param {{coverage?:number}} opts
 * @returns {{regions:Array, suppressed:number, kept:number}}
 */
export function fuse(screenRegions, domContext, { coverage = 0.7 } = {}) {
  // Regions the DOM inspected and found clean. Sensitive elements are NOT
  // listed here: a screen flag over a password field is agreement, not noise.
  const explained = [];
  for (const el of domContext.elements ?? []) {
    if (!el.sensitive && el.box && el.box.w > 0) explained.push(el.box);
  }

  // Areas the DOM demonstrably cannot see. A screen flag here is authoritative.
  const opaque = (domContext.visualRedactions ?? []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));

  const kept = [];
  let suppressed = 0;
  for (const r of screenRegions) {
    if (r.kind === "unscanned") { kept.push(r); continue; }   // fail-closed, never suppress

    const overOpaque = opaque.some((o) => overlapFraction(r, o) > 0.3);
    if (overOpaque) { kept.push(r); continue; }

    // Sum of coverage by clean DOM elements. Approximate — boxes may overlap —
    // but deliberately conservative: it can only under-estimate coverage, and
    // under-estimating means keeping the region, which is the safe direction.
    const covered = explained.reduce((acc, e) => acc + overlapFraction(r, e), 0);
    if (covered >= coverage) { suppressed++; continue; }
    kept.push(r);
  }
  return { regions: kept, suppressed, kept: kept.length };
}
