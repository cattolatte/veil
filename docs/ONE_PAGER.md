# Veil — one page

**Privacy-preserving on-device visual perception for browser agents**
SIH 2026 · `SIH26171` · ISRO / Department of Space

## Problem

AI agents become useful when they can see your screen. Almost every agentic
pipeline runs server-side, so the screen — passwords, faces, identifiers — must
leave the machine *before* anything decides it was sensitive.

## Approach

Split the pipeline at the trust boundary. A local vision model and a
checksum-verified detector run in the browser; only anonymised **structure**
crosses the network. The server sees `[[AADHAAR]]` and
`{filled: true, length: 7}` — never a value.

## Why this shape

The rubric is published, and it is not an accuracy competition:

| Weight | Criterion | Measured |
|:--:|---|---|
| 25% | Visual context accuracy | Face detection working; canvas text is a known gap |
| 20% | PII detection | **100% precision**, 92.5% text recall on real pages |
| 20% | Redaction precision | **100%** on real pages |
| 20% | Client resource use | **2.3 MB** heap |
| 15% | End-to-end latency | **4.5 ms** capture · 33 ms full round trip |

**35% of the score is resource use and latency.** That drives every decision: a
**227 KB** face detector rather than a 2 GB model; a **403 KB** tagger rather
than 278 MB.

## Evidence

| Corpus | What it is | Precision | Recall | F1 |
|---|---|---:|---:|---:|
| Generator | Ours | 99.4% | 80.5% | 88.9% |
| ai4privacy | 47,728 downloaded documents | 91.9% | 31.2% | 46.5% |
| Real pages | Live pages, injected PII | **100.0%** | 69.2% | 81.8% |

Three corpora that disagree, and the disagreement found two production bugs a
single corpus would have hidden.

## Engineering

- **18 milestones**, every one a PR with measured before/after deltas
- **9 architecture decision records**, including the decisions that were wrong
- **15 tests**, five of them the privacy invariants, enforced in CI
- Threat model, model cards, metric definitions, asset licensing

## What does not work yet

- Canvas-rendered text is undetected; masked wholesale by the fail-closed path
- 36.5% coverage of PII *types* — names and addresses have no pattern
- A tagger was trained for that gap and **not shipped**: it flags 15.1% of
  ordinary page text as PII

## Differentiator

No public dataset validates **Aadhaar, PAN, IFSC or UPI** — zero occurrences
across 4,000 external documents. Any team fine-tuning on public PII corpora
will be blind to every Indian identifier, at an ISRO-judged hackathon.
