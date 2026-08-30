# Screen perception

The client-side vision model the problem statement asks for: it reads the
rendered screen and evaluates its state, rather than inferring everything from
the DOM.

| | |
|---|---|
| Architecture | Convolutional encoder, strided ×3 then dilated context |
| Input / output | 512×320 RGB → 64×40 cell grid |
| Parameters | 435,297 |
| ONNX | **1.7 MB** self-contained |
| Runtime | ONNX Runtime Web, WebGPU with WASM fallback |
| Inference | ~160 ms CPU (on-demand, not per scan) |

## Results — held-out REAL pages

Layouts the model never trained on, split by page:

910 held-out real pages — layouts never trained on.

| threshold | precision | recall | F1 | screen flagged |
|---|---:|---:|---:|---:|
| 0.5 | 76.5% | 94.3% | 84.5% | 4.8% |
| 0.7 | 82.8% | 92.9% | 87.6% | 4.4% |
| 0.9 | 90.1% | 89.8% | 89.9% | 3.9% |
| **0.95** | **92.8%** | **87.5%** | **90.1%** | **3.7%** |
| 0.99 | 96.3% | 80.5% | 87.7% | 3.3% |

Shipped at **0.95**. F1 is flat between 0.90 and 0.95, so the tie breaks on
precision: redaction precision is its own 20% metric, and every false positive
is a black rectangle over content the user wanted to see.

## Why training data decided everything

| Training data | Real pages | Held-out pages | Real-page F1 |
|---|---:|---:|---:|
| Fixed synthetic template | 0 | 38 | 12.5% |
| Randomised synthetic layout | 0 | 38 | 18.4% |
| + real harvested pages | 117 | 38 | 72.2% |
| + more real pages | 384 | 127 | 84.1% |
| **+ 3,129 harvested pages** | **2,730** | **910** | **90.1%** |

Real pages were the whole curve, and the model architecture never changed once
across those five rows. The held-out set grew with it — 38 pages to 910 — so
the final figure is also the most trustworthy one.

Returns are compressing, as expected: 117→384 real pages bought twelve points,
384→2,730 bought six.

The first model scored **99.8% F1 on its own held-out split**. It had learned
where PII sits on one template. On real pages it flagged half the screen.

Validation is therefore always a held-out split of **real** pages. A synthetic
split cannot answer the only question that matters, and answered it wrongly
once already.

## Reproduce

```bash
python datagen/generate.py --n 500 --out datagen/screens_out --width 1280 --height 800
python datagen/harvest.py --out datagen/harvest_big --urls datagen/urls_large.txt --width 1280 --height 800
python datagen/harvest.py --out datagen/harvest_xl  --urls datagen/urls_xl.txt    --width 1280 --height 800
python vision/prepare.py     # splits real pages by page
python vision/train.py       # validates on held-out real pages throughout
python vision/export.py      # -> vision/out/screen.onnx (1.7 MB)
python vision/eval_real.py   # threshold sweep on real pages
```
