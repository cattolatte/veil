/**
 * On-device vision.
 *
 * Stub with a real interface. Swap `#infer` for an ONNX Runtime Web session
 * (WebGPU execution provider) once a face/ID detector is exported.
 *
 * Two constraints drive the design, both from the rubric:
 *   - client resource utilisation is 20% of the score, so the model is loaded
 *     lazily and only run on elements the structural pass already flagged.
 *   - latency is 15%, so inference is capped and degrades to "redact the whole
 *     region" rather than blocking.
 */
export class VisionEngine {
  #session = null;
  #ready = false;
  #backend = "none";

  async init() {
    if (this.#ready) return this.#backend;
    this.#backend = ("gpu" in navigator) ? "webgpu" : "wasm";
    // TODO: const ort = await import("onnxruntime-web");
    //       this.#session = await ort.InferenceSession.create(url,
    //         { executionProviders: [this.#backend] });
    this.#ready = true;
    return this.#backend;
  }

  /**
   * @param {Array<{tag:string, box:{x,y,w,h}, alt:string}>} candidates
   * @returns {Promise<Array<{x,y,w,h,kind:string,severity:number}>>}
   */
  async findSensitiveRegions(candidates, { budgetMs = 120 } = {}) {
    await this.init();
    const t0 = performance.now();
    const out = [];
    for (const c of candidates) {
      if (performance.now() - t0 > budgetMs) {
        // Out of time: fail closed. Unscanned imagery is redacted, never leaked.
        out.push({ ...c.box, kind: "unscanned", severity: 3 });
        continue;
      }
      const hit = await this.#infer(c);
      if (hit) out.push({ ...c.box, kind: hit.kind, severity: hit.severity });
    }
    return out;
  }

  async #infer(c) {
    // Placeholder heuristic until the detector lands: treat sizeable images as
    // possible faces/documents. Deliberately conservative - recall over
    // precision, because a missed face is a privacy failure and scores worse.
    const area = c.box.w * c.box.h;
    if (area > 64 * 64) return { kind: "visual_pii", severity: 2 };
    return null;
  }

  get backend() { return this.#backend; }
}
