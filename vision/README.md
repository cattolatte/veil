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

| threshold | precision | recall | F1 | screen flagged |
|---|---:|---:|---:|---:|
| 0.5 | 57.1% | 82.8% | 67.6% | 6.2% |
| 0.7 | 64.5% | 78.0% | 70.6% | 5.2% |
| **0.9** | **75.9%** | **68.8%** | **72.2%** | **3.9%** |
| 0.95 | 81.2% | 63.4% | 71.2% | 3.4% |
| 0.99 | 90.7% | 49.1% | 63.7% | 2.3% |

Shipped at **0.9**, the F1 peak. Recall is weighted slightly above precision
because this channel exists to catch what the DOM missed — a false positive
costs a blacked rectangle, a false negative leaks.

## Why training data decided everything

| Training data | Real-page F1 | Screen flagged |
|---|---:|---:|
| Fixed synthetic template | 12.5% | 50.0% |
| Randomised synthetic layout | 18.4% | 14.3% |
| **Synthetic + real harvested pages** | **72.2%** | **3.9%** |

The first model scored **99.8% F1 on its own held-out split**. It had learned
where PII sits on one template. On real pages it flagged half the screen.

Validation is therefore always a held-out split of **real** pages. A synthetic
split cannot answer the only question that matters, and answered it wrongly
once already.

## Reproduce

```bash
python datagen/generate.py --n 500 --out datagen/screens_out --width 1280 --height 800
python datagen/harvest.py --out datagen/harvest_big --urls datagen/urls_large.txt --width 1280 --height 800
python vision/prepare.py     # splits real pages by page
python vision/train.py       # validates on held-out real pages throughout
python vision/export.py      # -> vision/out/screen.onnx (1.7 MB)
python vision/eval_real.py   # threshold sweep on real pages
```
