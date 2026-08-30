# Veil

Privacy-preserving on-device visual perception for browser agents.

A local vision model reads the screen, sensitive content is detected and redacted **before any network request**, and only anonymised structure reaches the server — which returns an action the client executes.

> SIH 2026 · `SIH26171` · ISRO / Department of Space

## Why this shape

The scoring rubric is published, and it is not a vision-accuracy competition:

| Weight | Criterion |
|:--:|---|
| 25% | Accuracy of visual context from screen |
| 20% | Recall & precision of sensitive/PII detection |
| 20% | Precision of redaction |
| 20% | Client-side resource utilisation |
| 15% | End-to-end latency |

**40% is the privacy pipeline. 35% is engineering efficiency.** The architecture optimises for those directly: detection is checksum-verified to protect precision, redaction is span-level rather than element-level, and the vision pass runs under an explicit time budget that fails closed.

## Layout

```
extension/          browser extension (Chrome MV3 + Firefox)
  src/lib/          PII detection, redaction, context serialisation
  src/vision/       on-device inference (WebGPU / ONNX Runtime Web)
  src/content.js    runs in page — the only component that sees raw data
  src/background.js service worker — bridges client and server
server/             FastAPI — receives sanitised context, returns an action
datagen/            synthetic screen generator with exact ground truth
docs/               architecture notes
```

## Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt
uvicorn server.main:app --reload --port 8000
```

Load the extension: Chrome → `chrome://extensions` → Developer mode → *Load unpacked* → `extension/`.
Firefox → `about:debugging` → *Load Temporary Add-on* → `extension/manifest.firefox.json`.

Generate training data:

```bash
pip install -r datagen/requirements.txt && playwright install chromium
python datagen/generate.py --n 500 --out datagen/out
```

## Privacy invariant

The server must never be able to reconstruct a secret. Concretely:

- Form values are never transmitted — only `{filled: bool, length: int}`.
- Text is redacted span-wise into typed placeholders (`[[AADHAAR]]`, `[[PASSWORD]]`).
- URLs are truncated to origin + path; query strings are dropped.
- Imagery is masked on-canvas before serialisation; unscanned regions are redacted, not sent.
- The server independently audits inbound context for leaks and reports them, so a client-side failure is visible rather than silent.
