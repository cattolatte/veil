/**
 * Client-side cost measurement.
 *
 * Client resource utilisation is 20% of the score and end-to-end latency is
 * 15%, so both are instrumented in the pipeline itself rather than measured
 * once by hand. If a change makes the scan heavier, the popup shows it
 * immediately.
 *
 * `performance.memory` is Chrome-only and coarse (quantised, and affected by
 * GC timing), so heap numbers are reported as a best-effort signal, never as
 * a hard figure. Absence is reported as null rather than zero.
 */

export function heapBytes() {
  const m = performance.memory;
  return m && typeof m.usedJSHeapSize === "number" ? m.usedJSHeapSize : null;
}

/** Phase timer. `mark()` closes the previous phase and opens the next. */
export class Budget {
  #t0 = performance.now();
  #last = this.#t0;
  #heap0 = heapBytes();
  phases = {};

  mark(name) {
    const now = performance.now();
    this.phases[name] = +(now - this.#last).toFixed(2);
    this.#last = now;
  }

  finish() {
    const heap1 = heapBytes();
    return {
      totalMs: +(performance.now() - this.#t0).toFixed(2),
      phases: this.phases,
      // Delta can read negative if GC ran mid-scan. Reported as-is rather than
      // clamped, because a clamped zero would hide that the number is noisy.
      heapDeltaBytes: this.#heap0 !== null && heap1 !== null ? heap1 - this.#heap0 : null,
      heapUsedBytes: heap1,
    };
  }
}
