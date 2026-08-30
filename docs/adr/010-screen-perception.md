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

| Training data | Real-page F1 | Screen flagged |
|---|---:|---:|
| Fixed synthetic template | 12.5% | 50.0% |
| Randomised synthetic layout | 18.4% | 14.3% |
| **Synthetic + real harvested pages** | **72.2%** | **3.9%** |

Randomising layout, typography and adding prose filler helped — the positive
rate fell from 5.9% to 3.4% of cells, closer to reality — but nowhere near
enough. **Real page structure was the missing signal**, and specifically real
*negatives*: the vast expanse of ordinary content that must not be flagged.

Validation is a held-out split of real pages by page, never a synthetic split.
A synthetic split cannot answer the only question that matters, and answered it
wrongly once already.

## Consequences

At threshold 0.9 on held-out real pages: **P 75.9%, R 68.8%, F1 72.2%, 3.9% of
screen masked.** Recall is weighted slightly above precision because this
channel exists to catch what the DOM missed — a false positive costs a blacked
rectangle, a false negative leaks.

Cost: 1.7 MB model, ~160 ms CPU inference, and a `captureVisibleTab`
permission. All three are real and all three are the price of metric 1.

This is the fourth time the same failure mode has appeared — train on one
distribution, fail on another. It is now the project's most reliable prediction
about itself.
