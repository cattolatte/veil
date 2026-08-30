# ADR-005 — A 227 KB detector over a 2B-parameter model

**Status:** Accepted · **Date:** 2026-08-30

## Context

Canvas-rendered PII is invisible to any DOM scan — measured recall 0/58 on the
harvest corpus, and no regex will ever move it. Only a vision pass can read
those pixels.

The obvious candidate was UGround-V1, state of the art for GUI grounding.
Investigation:

- `osunlp/UGround-V1-Data` — **424.5 GB** across 3,584 files, `gated: auto`
- `osunlp/UGround-V1-2B` — ungated, but ~4 GB at fp16, ~1–1.5 GB quantised

## Decision

Ship **YuNet** (`face_detection_yunet_2023mar.onnx`, **227 KB**) through ONNX
Runtime Web on WebGPU.

The reasoning is arithmetic, not taste. Client resource utilisation is 20% of
the score and latency 15% — **35% combined, versus 20% for detection.** A model
that improves detection while degrading resource use and latency can be net
negative. Detecting a face well enough to mask it is a low bar; being cheap
enough not to forfeit 35% of the marks is not.

## Consequences

Detected **12 faces across two test images in-browser, matching an independent
Python run of the same model exactly** (1 + 11). Warm capture 134 ms, heap
9.9 MB, zero regions falling back to `unscanned`.

Scope is limited to faces. Rendered ID documents and text-in-canvas are not
detected; the fail-closed path masks those regions wholesale instead.

Two defects surfaced only by running it:

- ORT resolves its loader as a **module specifier**, so a relative `wasmPaths`
  throws before any backend initialises. It must be an absolute URL.
- The WebGPU build loads the **`asyncify`** runtime, not `jsep`. Shipping only
  `jsep` fails with a misleading "no available backend found" — and ORT caches
  that failure for the page lifetime, so retries report the stale error.

The ONNX runtime itself is 66 MB of assets, far larger than the model. It is
loaded lazily and only when a page actually contains imagery.
