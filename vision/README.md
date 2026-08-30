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

127 held-out real pages.

| threshold | precision | recall | F1 | screen flagged |
|---|---:|---:|---:|---:|
| 0.5 | 64.5% | 91.7% | 75.8% | 6.1% |
| 0.7 | 72.4% | 89.6% | 80.1% | 5.3% |
| 0.9 | 83.2% | 84.8% | 84.0% | 4.4% |
| **0.95** | **87.6%** | **80.8%** | **84.1%** | **4.0%** |
| 0.99 | 93.8% | 70.9% | 80.8% | 3.3% |

Shipped at **0.95**. F1 is flat between 0.90 and 0.95, so the tie breaks on
precision: redaction precision is its own 20% metric, and every false positive
is a black rectangle over content the user wanted to see.

## Why training data decided everything

| Training data | Real pages used | Real-page F1 | Screen flagged |
|---|---:|---:|---:|
| Fixed synthetic template | 0 | 12.5% | 50.0% |
| Randomised synthetic layout | 0 | 18.4% | 14.3% |
| + 117 real harvested pages | 117 | 72.2% | 3.9% |
| **+ 384 real harvested pages** | **384** | **84.1%** | **4.0%** |

Real pages are the scarce resource and the whole curve. Tripling them moved F1
twelve points; nothing else came close.

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
