# ADR-010 — A screen-perception model, trained on real pages

**Status:** Accepted · **Date:** 2026-08-30

## Context

The problem statement asks, verbatim, for

> a local Vision Transformer (ViT) or equivalent computer vision model 'reads'
> the user's screen and takes decision based on that

and for a

> client-side vision model running in the browser (e.g., via WebGPU) that
> evaluates the current screen state.

Metric 1 — *accuracy of visual context from screen* — is **25%** of the score.

We were not doing this. Screen understanding was entirely DOM-based; the only
vision model was YuNet, inspecting individual `<img>` elements for faces. No
screenshot was ever captured. Measured consequence: recall on canvas-rendered
PII was **0/58**, and no regex will ever move it.

## Decision

Capture the visible tab and run a small convolutional net over the rendered
screen, predicting per 8×8 cell whether the region holds content requiring
redaction.

- **512×320 input, 64×40 output grid**, 435,297 parameters, 1.7 MB ONNX.
- **Convolutional, not a patch transformer.** ONNX Runtime's WebGPU backend
  handles convolutions well and runs them in parallel; attention kernels are
  patchier and often fall back to WASM. Latency is 15% of the score.
- **Region prediction, not reading.** The model need not recover a digit — only
  say "this area must be masked". A far cheaper problem, and the one the
  redaction-precision metric actually scores.
- **On-demand, not per-scan.** ~160 ms on CPU. The cheap DOM pass (8.9 ms) runs
  always; the screen pass runs when visual context is genuinely required.
- **Capture lives in the service worker**, because `captureVisibleTab` is
  privileged. The raw frame never enters the page.
- **Pixels are destroyed, not covered.** Opaque rectangles are drawn onto the
  bitmap before encoding. A CSS overlay would still ship the original beneath
  it, and a blur of large text is often still legible.

## The part that took three attempts

Trained on the generator alone, the model scored **99.8% F1 on its own held-out
split and 12.5% on real pages, flagging 50% of the screen.** It had learned
where PII sits on that template, not what it looks like.

| Training data | Real pages | Real-page F1 | Screen flagged |
|---|---:|---:|---:|
| Fixed synthetic template | 0 | 12.5% | 50.0% |
| Randomised synthetic layout | 0 | 18.4% | 14.3% |
| + 117 real harvested pages | 117 | 72.2% | 3.9% |
| **+ 384 real harvested pages** | **384** | **84.1%** | **4.0%** |

Randomising layout, typography and adding prose filler helped — the positive
rate fell from 5.9% to 3.4% of cells, closer to reality — but nowhere near
enough. **Real page structure was the missing signal**, and specifically real
*negatives*: the vast expanse of ordinary content that must not be flagged.

Validation is a held-out split of real pages by page, never a synthetic split.
A synthetic split cannot answer the only question that matters, and answered it
wrongly once already.

## Fusing with the DOM

The two channels fail in opposite directions, so the DOM arbitrates. Where the
DOM can account for a region — ordinary text the scanner examined and found
clean — a screen flag is more likely a false positive than a discovery, and is
suppressed. Where the DOM demonstrably cannot see (canvas, image, video), the
screen model is the only witness and its flag stands. `unscanned` regions are
never suppressed. Implemented in `extension/src/vision/fuse.js`.

## Consequences

At threshold 0.95 on **127 held-out real pages**: **P 87.6%, R 80.8%, F1 84.1%,
4.0% of screen masked.**

Real pages proved to be the whole curve. Tripling them — 117 to 384 — moved F1
twelve points; no architectural change came close. That is worth recording
because the instinct when a model underperforms is to change the model.

Cost: 1.7 MB model, ~160 ms CPU inference, and a `captureVisibleTab`
permission. All three are real and all three are the price of metric 1.

This is the fourth time the same failure mode has appeared — train on one
distribution, fail on another. It is now the project's most reliable prediction
about itself.
