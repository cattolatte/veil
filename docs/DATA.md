# Data strategy

## The dataset you need does not exist

Every public PII dataset is **text**. Every public GUI dataset is **screens
without PII labels**. The intersection — a rendered web page with element-level
ground truth for what should be masked — is empty.

That is why `datagen/` exists. It is not a fallback; it is the only source of
ground truth for 20% of the rubric.

## Public datasets, and what each is actually for

### PII (text)

| Dataset | Scale | Use |
|---|---|---|
| [ai4privacy/pii-masking-openpii-1m](https://huggingface.co/datasets/ai4privacy/pii-masking-openpii-1m) | 1,428,143 examples · 23 languages · 19 entity types | Primary recall training |
| [ai4privacy/pii-masking-200k](https://huggingface.co/datasets/ai4privacy/pii-masking-200k) | 54 PII classes · 229 use cases | Secondary / class coverage |
| [PIIBench](https://arxiv.org/pdf/2604.15776) | 2.37M sequences · 3.35M mentions · 48 types | Held-out validation |

### GUI / screen understanding

| Dataset | Scale | Use |
|---|---|---|
| [UGround-V1](https://arxiv.org/pdf/2410.05243) | 10M elements · 1.3M screenshots | Grounding pretraining |
| [ScreenSpot-Pro](https://arxiv.org/html/2504.07981v1) | 23 professional applications, high-res | Generalisation check |
| [Mind2Web](https://arxiv.org/pdf/2410.13824) | 2,000+ tasks · 137 sites · 31 domains | End-to-end agent tasks |

### The gap worth exploiting

Public PII corpora skew English and European — OpenPII covers 23 *European*
languages. **Aadhaar, PAN, IFSC and UPI are essentially uncovered.** A model
fine-tuned only on these will miss Indian identifiers and will flag ordinary
12-digit order numbers as Aadhaar.

`datagen/` emits checksum-valid Indian PII *and* checksum-failing decoys, so
both recall and precision are trained where the public field is weakest.

## Ground truth by construction

Inject known PII into known DOM nodes → screenshot → resolve each node's
post-layout box. Labels are exact because we placed them. No annotation cost,
no label noise, unlimited volume.

Hard cases are generated deliberately:

- **split** — PII spread across inline elements, defeating naive text-node scanning
- **canvas** — PII drawn into `<canvas>`, invisible to any DOM scan
- **decoys** — strings that look like PII but fail checksum

Decoys are built by perturbing a valid check digit, then verified to produce
zero true positives, so precision numbers stay honest. (An earlier revision
used 16 random digits, which pass Luhn about 10% of the time — real card
numbers mislabelled as decoys, quietly inflating precision.)

## Baseline

60 pages, 465 labelled instances, text pass only, no vision:

```
precision  98.1%   recall  74.8%   F1  84.9%      (perNode — what content.js does)

canvas    0/60     0.0%    text scanning cannot see canvas content
split    42/84    50.0%    inline splitting halves recall
```

Three findings, each actionable:

1. **Canvas recall is 0%, and cannot be improved by better regex.** This is the
   empirical case for the on-device vision pass — it is the only thing that can
   read those pixels.
2. **Splitting across inline elements costs half the recall** on affected
   instances. Fix by joining adjacent inline siblings before scanning, rather
   than scanning each text node in isolation.
3. **The 6 false positives are all grouped-digit strings** (`1234 5678 9012`)
   that match the Aadhaar pattern and pass Verhoeff by chance — roughly 10% of
   such strings will. Fix with a context requirement: a nearby `aadhaar`/`uid`
   label, or rejection when an adjacent label names something else.

`joined` mode is reported alongside `perNode` specifically so the cost of
finding (2) is visible rather than hidden behind friendlier preprocessing.

## Running it

```bash
python datagen/generate.py --n 500 --no-screenshots --out datagen/out   # no browser needed
node eval/detect.mjs datagen/out/manifest.jsonl eval/out/predictions.jsonl
python eval/score.py datagen/out/manifest.jsonl eval/out/predictions.jsonl
```

Add screenshots (needs `playwright install chromium`) by dropping
`--no-screenshots`; pixel boxes are required for the visual-redaction metrics.
