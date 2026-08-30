# Character-level PII tagger — experimental, NOT in the pipeline

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
| ONNX size | **18 KB** |
| Training | 82 s on Apple GPU, 84,777 windows from ai4privacy |
| Byte-level F1 | **91.0%** (P 86.7% / R 95.8%) |

Byte level rather than subword: no tokenizer to ship or keep in sync with the
browser, every script including Devanagari works without a vocabulary, and it
degrades gracefully on the mangled text real pages contain.

Dilated CNN rather than BiLSTM: convolutions are well supported by ONNX
Runtime's WebGPU backend and run in parallel across the sequence, while an LSTM
steps serially and often falls back to WASM. Latency is 15% of the score.

For comparison, the off-the-shelf option `onnx-community/multilang-pii-ner`
is **278 MB** quantised — 15,000× larger. With 20% of the rubric on client
resource use, shipping it would lose more marks than the accuracy gains.

## Why it is not wired in

**It flags 15.1% of ordinary page text as PII.**

Measured over 8 real pages before any injection — text that is almost entirely
not personal data:

```
page text bytes:  50,497
flagged as PII:    7,618   (15.1%)
sample flags: 'Wikipedia'  'Main'  'Bank'  'Wikipedia Jump'
```

This is the same failure as the date regex one milestone earlier, and it has
the same cause. ai4privacy is form-shaped: filled templates where nearly every
proper noun IS personal data. Real web pages are prose, where nearly none of
them are. A model trained on the first distribution over-fires on the second.

Shipping it would take redaction precision — 20% of the score — from 100% to
somewhere near zero.

## What would fix it

Train with negative examples from real prose. The harvester already produces
exactly that: real pages, where everything except the planted values is known
to be O. Mixing real-page negatives into training at roughly 1:1 should
collapse the false-positive rate while keeping recall on genuine PII.

Until that is done and measured on the harvest corpus, this stays out of the
pipeline.

## Reproduce

```bash
python ner/prepare.py     # ai4privacy -> byte-level BIO windows
python ner/train.py       # ~82 s on Apple GPU
python ner/export.py      # -> ner/out/pii_tagger.onnx (18 KB)
```
