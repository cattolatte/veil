# Character-level PII tagger — shipped

## Why it exists

The regex layer attempts **8 of 28** PII types in ai4privacy — 36.5% of
instances. The other 63.5% are names, addresses, usernames and cities, and
regex cannot detect a person's name because there is no pattern to match. So
the current architecture has a hard recall ceiling around 36.5% regardless of
how well the patterns are tuned.

A model is the only way past that ceiling.

## What was built

| | |
|---|---|
| Architecture | Dilated CNN, byte-level, receptive field ±63 bytes |
| Parameters | **100,169** |
| ONNX size | **403 KB** self-contained |
| Training | 82 s on Apple GPU, 84,777 windows from ai4privacy |
| Byte-level F1 | **91.0%** (P 86.7% / R 95.8%) |

Byte level rather than subword: no tokenizer to ship or keep in sync with the
browser, every script including Devanagari works without a vocabulary, and it
degrades gracefully on the mangled text real pages contain.

Dilated CNN rather than BiLSTM: convolutions are well supported by ONNX
Runtime's WebGPU backend and run in parallel across the sequence, while an LSTM
steps serially and often falls back to WASM. Latency is 15% of the score.

For comparison, the off-the-shelf option `onnx-community/multilang-pii-ner`
is **278 MB** quantised — 690× larger. With 20% of the rubric on client
resource use, shipping it would lose more marks than the accuracy gains.

## It was withheld for two milestones, and why

Trained on ai4privacy alone it flagged **15.1% of ordinary page text** as PII —
`Wikipedia`, `Main`, `Bank`. That corpus is form-shaped, where nearly every
proper noun IS personal data; real pages are prose, where nearly none are.
Shipping it then would have taken redaction precision from 100% to near zero.

## What fixed it

**Real-prose negatives.** The harvester captures each page *before* injection,
so its baseline text is real and known-clean. 500 such pages — 125,688 windows,
every byte labelled `O` — were mixed into training.

| | before | after |
|---|---:|---:|
| Flagged on real page prose | 15.1% | **0.0%** |
| Detects genuine PII | yes | yes |

Same fix as the screen model, same failure mode. Fourth and fifth occurrences
of the same lesson.

## And a confidence threshold

Argmax alone still over-fired on **UI chrome** — short title-case button and
heading text, a third distribution again. Observed on a page of interface text:
18 detections where 3 were correct, with `Nothing`, `Press` and `Run` tagged.

Requiring **0.90 confidence** rather than merely the best class fixed it: 18
finds → 6, with zero UI words wrongly redacted and the genuine name and address
still caught.

## Performance

| | |
|---|---|
| Neural pass | **~10 ms** warm |
| Backend | WebGPU |
| Opt-in | Yes — off by default |

Two optimisations took it from 1,623 ms to ~10 ms, a 160× improvement:

- **int32 input instead of int64.** Building a `BigInt64Array` per inference
  dominated the cost; byte values need nowhere near 64 bits.
- **Batched block scanning.** A page yields dozens of short blocks, and
  per-call overhead swamped the compute. Joining them and scanning once cuts
  inference calls by an order of magnitude.

## Reproduce

```bash
python ner/prepare.py     # ai4privacy -> byte-level BIO windows
python ner/train.py       # ~82 s on Apple GPU
python ner/export.py      # -> ner/out/pii_tagger.onnx (403 KB)
```
