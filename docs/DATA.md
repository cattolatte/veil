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

## Provenance and licensing

Every external asset, where it came from, and what its terms allow. Checked
because a hackathon submission that ships an asset it cannot legally use is a
disqualification risk, not a footnote.

| Asset | Source | Licence | Gated | Used for |
|---|---|---|---|---|
| `pii-masking-300k` | HuggingFace `ai4privacy` | Open (research/commercial per card) | No | External validation, tagger training |
| ScreenSpot-v2 | HuggingFace `OS-Copilot` | Open | No | Screen-grounding evaluation |
| WIDER FACE samples | HuggingFace `Bingsu/wider_face_yolo` | Open, research | No | Vision-pass test images |
| YuNet ONNX | GitHub `opencv/opencv_zoo` | **Apache-2.0** | No | **Ships in the extension** |
| ONNX Runtime Web | npm `onnxruntime-web` | **MIT** | No | **Ships in the extension** |
| Harvested pages | Live fetch (Wikipedia, MDN, W3C, python.org…) | Page content not redistributed | — | Real-page evaluation |

Two notes on the last row. Harvested pages are **evaluation fixtures, not a
redistributed dataset** — `datagen/harvest_out/` is gitignored and regenerated
by fetching. And the harvester loads a fixed, modest list of public,
robots-friendly pages at human pace; it is not a crawler.

Only two assets actually ship: YuNet (Apache-2.0) and ONNX Runtime (MIT). Both
permit redistribution.

**`UGround-V1-Data` was deliberately not used** — 424.5 GB and `gated: auto`,
requiring a licence acceptance under the user's own account. See
[ADR-005](adr/005-small-vision-model.md).

## Three corpora, three different truths

The detector is scored on three sets, because each catches what the others hide:

| Corpus | What it is | What it catches |
|---|---|---|
| `datagen/` | Our generator | Regressions; the only source of pixel-level redaction ground truth and of Indian identifiers |
| ai4privacy | External, form-shaped documents | Whether we generalise beyond our own generator |
| `harvest/` | **Real pages with injected PII** | Whether we survive real prose |

The third one earns its place. Adding textual date patterns scored **93.1% F1**
on ai4privacy and **12.8%** on real pages — 257 false positives across five
pages, precision 99.4% → 7.1%. Encyclopedia articles are full of dates about
the world; form corpora are full of dates about a person. Only real pages
exposed it.

Requiring birth context (`born`, `date of birth`, `D.O.B.`) before treating a
date as PII:

| Corpus | before | after |
|---|---|---|
| Real pages | P 7.1% · F1 12.8% | **P 80.8% · F1 75.0%** |
| Synthetic | P 99.4% · F1 91.8% | P 99.4% · F1 88.9% |
| ai4privacy | P 91.2% · F1 58.9% | P 91.9% · F1 46.5% |

That cost on ai4privacy is real but partly an artifact: it is plain text with
no DOM, so structural detection cannot contribute. In the product a date in an
`autocomplete="bday"` field is caught structurally regardless of surrounding
prose. The trade is tuned for the deployment distribution — an agent browsing
real pages — and the alternative was a detector that redacts every date in
every article.

## External validation — the number that matters

Our own generator can only prove we did not regress. It cannot prove the
detector generalises, because we wrote both the data and the detector. So the
detector is also scored against **ai4privacy/pii-masking-300k**, an external
corpus of 47,728 documents with span-level labels across 28 PII types.

English split, 7,946 documents:

| kind | precision | recall | F1 |
|---|---:|---:|---:|
| dob | 92.8% | 93.5% | **93.1%** |
| email | 91.5% | 94.2% | **92.8%** |
| id_number | 95.3% | 18.9% | 31.6% |
| phone_in | 0.0% | 0.0% | 0.0% |
| **overall** | **91.2%** | **43.5%** | **58.9%** |

Read this honestly. On our own set the detector scores F1 91.8%; on external
data it scores 58.9%. That gap is what "tested on data we made ourselves"
costs, and it is the first question a judge should ask.

Per-kind is more informative than the aggregate:

- **email and dob generalise** — both above 92% F1 on data we have never seen.
- **`phone_in` scores 0% by construction.** The pattern targets Indian mobile
  numbers (`[6-9]` + 9 digits); this corpus is French, German, Italian,
  English, Spanish and Dutch. It contains no Indian numbers to find. The 168
  false positives are the real signal here, not the zero.
- **`id_number` trades recall for precision.** A label (`Driver's License:`,
  `Passport:`) is required before a token is treated as an identifier. Most
  gold IDs in this corpus appear in bare lists with no label, hence 18.9%
  recall — but requiring the label is what holds precision at 95.3%. Dropping
  it would sweep up every order number on the page.

### What the external corpus cannot tell us

Probing 4,000 English documents for Indian identifiers:

| | occurrences |
|---|---:|
| PAN | **0** |
| IFSC | **0** |
| UPI VPA | **0** |
| Aadhaar-shaped | 51 *(coincidental foreign IDs)* |

**No public corpus validates Aadhaar, PAN, IFSC or UPI detection.** That is
precisely the gap the generator fills, and precisely why it is not optional.

## Internal baseline

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
