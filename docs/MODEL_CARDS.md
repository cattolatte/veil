# Model cards

Two models ship or are staged in this repository. Both are documented here in
the standard model-card structure, including intended use, measured
performance, and the failure modes we know about.

---

## 1. YuNet face detector — **in the pipeline**

| | |
|---|---|
| File | `extension/models/yunet_face.onnx` |
| Size | **227 KB** |
| Source | [opencv/opencv_zoo](https://github.com/opencv/opencv_zoo) · `face_detection_yunet_2023mar.onnx` |
| Licence | Apache-2.0 (OpenCV Zoo) |
| Provenance | Downloaded verbatim; **not** retrained or fine-tuned by us |
| Input | `[1, 3, 640, 640]` float32, **BGR**, raw 0–255, no normalisation |
| Output | 12 tensors — `cls/obj/bbox/kps` at strides 8, 16, 32 |
| Runtime | ONNX Runtime Web 1.29.0, WebGPU with WASM fallback |

**Intended use.** Locate faces in page imagery so they can be masked before the
frame is described to a server. Detection quality only needs to be good enough
to place a mask.

**Not intended for.** Face *recognition*, identity matching, demographic
inference, or any decision about a person. It outputs boxes and is used only to
destroy information.

**Measured performance.** 12 faces across two WIDER FACE images in-browser,
matching an independent Python run of the same model exactly (1 + 11 in a crowd
scene). Confidence 0.79–0.93. Cold 447 ms including model load, warm 134 ms,
heap 9.9 MB.

**Known limitations.**
- Faces only. **Rendered text — an Aadhaar number drawn into a canvas — is not
  detected.** This is the largest residual privacy risk in the system.
- Small faces in crowds are detected at low confidence; the 0.6 threshold will
  miss some.
- Upstream training data (WIDER FACE) has documented demographic imbalance.
  Since a miss means *failure to mask*, uneven recall across skin tones or face
  shapes is a **fairness-relevant privacy risk**, not merely an accuracy issue.
  We have not measured this and should not claim uniform protection.

**Mitigation for all of the above.** Any visual region not successfully scanned
is redacted wholesale rather than transmitted ([ADR-003](adr/003-fail-closed.md)).

---

## 2. Character-level PII tagger — **NOT in the pipeline**

| | |
|---|---|
| File | `ner/out/pii_tagger.onnx` (gitignored; rebuild with `ner/export.py`) |
| Size | **403 KB** self-contained · 100,169 parameters |
| Architecture | Byte-level dilated CNN — embed(256→64), 5 residual blocks at dilations 1/2/4/8/16, 1×1 head |
| Receptive field | ±63 bytes |
| Training data | ai4privacy/pii-masking-300k validation split — 47,728 documents, 6 languages |
| Training | 4 epochs, AdamW, OneCycle max-lr 3e-3, batch 64, ~82 s on Apple M-series MPS |
| Classes | `NAME`, `ADDR`, `USER`, `IP` (BIO), plus `O` |

**Intended use.** Detect PII categories that have no pattern to match — names,
addresses, usernames — which is the 63.5% of instances the regex layer cannot
attempt.

**Measured performance.** Byte-level P 86.7% / R 95.8% / **F1 91.0%** on a held-out
8% split of its own training distribution.

Per class (byte level): `IP` P 93.8 / R 99.6 · `ADDR` P 86.0 / R 97.6 ·
`NAME` P 68.7 / R 95.6 · `USER` P 64.5 / R 96.6.

**Why it is not deployed.** It flags **15.1% of ordinary page text** as PII —
7,618 of 50,497 bytes across 8 real pages before any injection. Samples:
`"Wikipedia"`, `"Main"`, `"Bank"`. Deploying it would take redaction precision
from 100% to near zero.

**Root cause.** Distribution mismatch, identical to the date-pattern failure in
[ADR-006](adr/006-context-requirements.md). ai4privacy is form-shaped, where
nearly every proper noun is personal data. Real pages are prose, where nearly
none are.

**Path to deployment.** Mix negative examples from real prose — which the
harvester already produces, since every byte outside a planted span is known-`O`
— at roughly 1:1, then re-measure on the harvest corpus before wiring in.

**Ethical note.** The class labels are coarse by design. The model decides
*whether to mask*, never anything about a person. A `NAME` mislabelled as
`ADDR` is harmless because both outcomes are redaction.
