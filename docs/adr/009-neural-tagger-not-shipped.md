# ADR-009 — Build the neural tagger, do not ship it yet

**Status:** Accepted · **Date:** 2026-08-30

## Context

The regex layer attempts **8 of 28** PII types in ai4privacy — 36.5% of
instances. The remainder are names, addresses, usernames and cities. Regex
cannot detect a person's name; there is no pattern. The architecture therefore
has a **hard recall ceiling near 36.5%** however well the patterns are tuned,
which is why further regex work has no headroom.

Off-the-shelf options were measured:

| Model | Quantised size |
|---|---|
| `onnx-community/multilang-pii-ner` | 278 MB |
| `onnx-community/distilbert-NER` (q4f16) | 69.5 MB |

Against a 20% resource weight, 278 MB plausibly loses more than the detection
gain is worth.

## Decision

Train a purpose-built tagger, and **do not wire it into the pipeline yet**.

Architecture: byte-level dilated CNN, dilations 1/2/4/8/16, receptive field
±63 bytes. **100,169 parameters, 403 KB ONNX**, 82 s to train, byte-level F1
**91.0%**.

- **Byte level** — no tokenizer to ship or keep in sync with the browser, any
  script works without a vocabulary, degrades gracefully on mangled page text.
- **Dilated CNN, not BiLSTM** — convolutions are well supported by ONNX Runtime
  WebGPU and parallelise across the sequence; an LSTM steps serially and often
  falls back to WASM. Latency is 15% of the score, so architecture was chosen
  for how it *runs*, not only how it trains.

## Why it is not shipped

**It flags 15.1% of ordinary page text as PII.** Measured over 50,497 bytes of
real pages before any injection:

```
flagged: 7,618 bytes (15.1%)
samples: "Wikipedia"  "Main"  "Bank"  "Wikipedia Jump"
```

Same failure as ADR-006's date patterns, same cause: ai4privacy is form-shaped,
where nearly every proper noun is personal data; real pages are prose, where
nearly none are. Shipping it would take redaction precision — 20% of the score
— from 100% to near zero.

## Consequences

The recall ceiling stands until this is fixed. The path is known and cheap:
train with negative examples from real prose, which the harvester already
produces — real pages where everything except planted values is known-`O`.
Mixing at roughly 1:1 should collapse false positives while preserving recall.

403 KB versus 278 MB means the resource budget is not the constraint. Data
distribution is.

**Correction.** This ADR first reported 18 KB. That was the graph file only —
torch's exporter had written the weights to a `.onnx.data` sidecar, and the
self-contained model is 403 KB. Caught by a CI hygiene check that flagged the
sidecar as a committed build artefact. The argument is unchanged; the number
was wrong.
