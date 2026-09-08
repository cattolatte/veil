# Model cards

**Three models ship in this repository**, and they satisfy different clauses of
the problem statement. Each is documented in the standard model-card structure,
including intended use, measured performance, and the failure modes we know
about.

| # | Model | Size | Which requirement it satisfies | Rubric |
|---|---|---|---|---|
| 1 | YuNet face detector | 227 KB | *"blurring faces"* — the Privacy Preserving Filter | part of 20% |
| 2 | Screen-perception model | 1.7 MB | *"a local ViT **or equivalent** … reads the user's screen"* | **25%** |
| 3 | Character-level PII tagger | 403 KB | names and addresses, which no pattern can match | part of 20% |

Model 2 is the one the statement names, and it carries the largest single weight
in the rubric. Model 1 is the one most people notice first, because faces are
the example the statement gives.

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

## 2. Screen-perception model — **in the pipeline**

The model the problem statement asks for by name:

> "a local Vision Transformer (ViT) **or equivalent computer vision model**
> 'reads' the user's screen"

It carries **metric 1 — accuracy of visual context from screen — 25% of the
score**, the single largest weight in the rubric.

| | |
|---|---|
| File | `extension/models/screen.onnx` |
| Size | **1.7 MB** · 435,297 parameters |
| Architecture | Small convolutional net. 512×320 input → 64×40 output grid; one prediction per 8×8 cell |
| Output | Per-cell: does this region hold content requiring redaction |
| Provenance | **Trained by us.** Not downloaded |
| Runtime | ONNX Runtime Web, WebGPU with WASM fallback |
| Latency | ~160 ms on CPU, run on demand rather than every scan |

**Why convolutional and not a ViT.** The statement says *"or equivalent"*, and
the choice was measured rather than stylistic: ONNX Runtime's WebGPU backend
handles convolutions well and parallelises them, while attention kernels are
patchier and often fall back to WASM. Latency is 15% of the score, so a
transformer that silently drops to CPU is a losing trade.

**Why region prediction and not reading.** The model never has to recover a
digit — only to say *"this area must be masked"*. That is a far cheaper problem,
and it is the one metric 3 (redaction precision) actually scores.

**Pixels are destroyed, not covered.** Opaque rectangles are drawn onto the
bitmap before encoding. A CSS overlay would still ship the original underneath,
and a blur of large text is frequently still legible.

**Capture lives in the service worker**, because `captureVisibleTab` is
privileged. The raw frame never enters the page.

### What it cost to get right

Trained on the synthetic generator alone, it scored **99.8% F1 on its own
held-out split and 12.5% on real pages, flagging half the screen.** It had
learned where PII sits on one template, not what PII looks like.

| Training data | Real pages | Held out | Real-page F1 |
|---|---:|---:|---:|
| Fixed synthetic template | 0 | 38 | 12.5% |
| Randomised synthetic layout | 0 | 38 | 18.4% |
| + real harvested pages | 117 | 38 | 72.2% |
| + more real pages | 384 | 127 | 84.1% |
| **+ 3,129 harvested pages** | **2,730** | **910** | **90.1%** |

Randomising layout and typography helped a little. **Real page structure was the
missing signal** — and specifically real *negatives*: the vast expanse of
ordinary content that must not be flagged.

Validation is a held-out split of **real pages, by page** — never a synthetic
split. A synthetic split cannot answer the only question that matters, and
answered it wrongly once already.

### Fusing with the DOM

The two channels fail in opposite directions, so the DOM arbitrates
(`extension/src/vision/fuse.js`):

- Where the DOM **can** account for a region — ordinary text the scanner
  examined and found clean — a screen flag is more likely a false positive than
  a discovery, and is suppressed.
- Where the DOM **demonstrably cannot see** — canvas, image, video — the screen
  model is the only witness and its flag stands.
- `unscanned` regions are **never** suppressed.

### Known limitations

- Region-level, not character-level: it says *where*, never *what*.
- ~160 ms means it runs on demand, so a page changing faster than that can be
  captured mid-change.
- Trained on harvested public pages; an unusual internal application may be
  out of distribution.

---

## 3. Character-level PII tagger — **in the pipeline**

| | |
|---|---|
| File | `extension/models/pii_tagger.onnx` · source at `ner/out/` (rebuild with `ner/export.py`) |
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
