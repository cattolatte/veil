# Metrics and reproducibility

Numbers in this repository are meaningless without saying what was counted.
This document defines every metric precisely and records the environment that
produced the figures.

## What counts as a detection

A prediction is a `(kind, value)` pair. Ground truth is a planted or annotated
`(kind, value)` pair.

**Matching is by normalised value, not by offset.** Values are compared after
stripping every non-alphanumeric character and upper-casing, so
`2341 2341 2346` and `234123412346` are the same instance.

| Outcome | Definition |
|---|---|
| **TP** | A ground-truth instance whose `(kind, normalised value)` appears in predictions. Consumed on match, so duplicates cannot be double-counted. |
| **FN** | A ground-truth instance with no matching prediction. |
| **FP** | A prediction left over after all ground truth is matched. |

**Why value-matching rather than span overlap.** An earlier version matched by
*count* per kind, which credited a canvas miss whenever any other instance of
the same kind was found on the page. It reported **56.7% canvas recall where
the true figure was 0%**. Value matching removed a whole class of self-flattery.

### Exclusions, and why each is honest

- **Pre-existing PII (real-page corpus only).** Pages are scanned *before*
  injection; anything found is subtracted from the FP pool. python.org and
  gnu.org publish genuine contact addresses — detecting them is correct, and
  counting them as errors measured the harness, not the detector. This
  correction moved real-page precision **79.5% → 100.0%**.
- **Structural-only kinds (external corpus).** `password` is detected from
  `<input type=password>`, which plain text cannot contain. Scoring it against
  a text corpus would deflate recall for a reason unrelated to the detector.
- **Unmapped label types (external corpus).** ai4privacy has 28 label types; we
  target 8. Counting `DRIVERLICENSE` as a miss for a detector that never
  claimed to find it would be dishonest in the opposite direction. The
  *coverage* figure — 36.5% — is reported separately and is the real limitation.

**`phone_in` is NOT excluded** from the external corpus despite scoring 0%
there by construction — the pattern targets Indian mobiles and the corpus is
European. Excluding it would flatter the aggregate.

## Extraction modes

The offline harness scores three text-extraction strategies, because the
difference between them is itself a finding:

| Mode | Behaviour |
|---|---|
| `perNode` | Each text node scanned alone — the naive baseline |
| `block` | Text grouped by nearest block-level ancestor — **what the product does** |
| `joined` | Whole page as one string — optimistic; silently rejoins split PII |

Headline figures use `block`. `perNode` and `joined` are retained so the cost
of the naive approach stays visible instead of disappearing behind friendlier
preprocessing ([ADR-007](adr/007-block-ancestor-grouping.md)).

## Latency and resource

- **Latency** is wall-clock around `buildContext()`, measured with
  `performance.now()` in a real browser, on a page of stated DOM size.
- **Warm median** discards the first two runs: they include lazy
  initialisation and are not representative. Cold figures are reported
  separately, never merged into the median.
- **Heap** is `performance.memory.usedJSHeapSize` — Chrome-only, quantised, and
  affected by GC timing. Reported as a signal, never as a hard figure. A
  negative delta from mid-scan GC is reported as-is rather than clamped,
  because a clamped zero would hide that the number is noisy.

## Known measurement limitations

- **The real-page corpus harvests live pages**, so page content changes between
  runs and the page count varies. Observed: F1 81.9% (29 pages) → 81.8% (28
  pages). Treat the third significant figure as noise.
- **The offline harness does not run the vision pass.** Canvas instances score
  0% there by construction; the product handles them via YuNet. Real-page
  recall excluding canvas is 92.5%.
- **`n` is small on the real-page corpus** — ~230 instances across ~28 pages.
  Directionally sound, not statistically tight.
- **No confidence intervals are reported.** With a single run per corpus and no
  bootstrap, they would be theatre.

## Environment

Figures in the README and CHANGELOG were produced on:

| | |
|---|---|
| Platform | macOS 26.5.1, arm64 (Apple silicon) |
| Python | 3.13.9 |
| Node | 26.3.1 |
| PyTorch | 2.13.0 (MPS backend available) |
| onnxruntime / onnxruntime-web | 1.29.0 |
| esbuild | 0.24.2 |
| numpy / pandas | 2.3.5 / 2.3.3 |
| Browser | Chromium via Playwright, WebGPU available |

**Seeds.** The generator seeds per page (`random.seed(i)`), so a given `--n`
reproduces byte-identically. The harvester seeds from `--seed` (default 0) but
**cannot** be fully deterministic, because it fetches live pages. Training uses
`torch.Generator().manual_seed(0)` for the train/val split; kernel
non-determinism on MPS means training metrics vary by a few tenths between
runs.

## Reproducing every headline figure

```bash
# Synthetic — P 99.4 / R 80.5 / F1 88.9
python datagen/generate.py --n 60 --no-screenshots --out datagen/out
node eval/detect.mjs datagen/out/manifest.jsonl eval/out/predictions.jsonl
python eval/score.py datagen/out/manifest.jsonl eval/out/predictions.jsonl --mode block

# External — P 91.9 / R 31.2 / F1 46.5
node eval/external.mjs datagen/external/pii300k-en.jsonl

# Real pages — P 100.0 / R ~69 / F1 ~81.8  (varies: live pages)
python datagen/harvest.py --out datagen/harvest_out --urls datagen/urls.txt --per-page 8
node eval/detect.mjs datagen/harvest_out/manifest.jsonl eval/out/harvest-preds.jsonl
python eval/score.py datagen/harvest_out/manifest.jsonl eval/out/harvest-preds.jsonl --mode block
```
