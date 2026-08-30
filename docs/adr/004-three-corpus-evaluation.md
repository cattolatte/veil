# ADR-004 — Evaluate on three corpora that disagree

**Status:** Accepted · **Date:** 2026-08-30

## Context

No public dataset contains "a rendered web page with pixel-level ground truth
for what should be masked". It cannot exist: annotating it would require
someone to hand-label rendered pages, and publishing real PII is precisely the
harm this field exists to prevent.

Every PII corpus in use is therefore synthetic. ai4privacy is generated;
OpenPII-1M describes itself as 1,428,143 *synthetic* examples; UGround-V1 is
built from web-based synthetic data. The choice is not real versus generated —
it is **whose generator, and can you check it.**

Testing only against our own generator is circular: writing both the data and
the detector proves nothing.

## Decision

Score on three corpora, each catching what the others hide:

| Corpus | What it is | What it catches |
|---|---|---|
| `datagen/` | Our generator | Regressions; the only source of pixel-level redaction ground truth and of Indian identifiers |
| ai4privacy | External, form-shaped documents | Whether we generalise beyond our own generator |
| `harvest/` | Real pages, injected PII | Whether we survive real prose |

## Consequences

The three disagree, and the disagreement is the point. Current figures:

| Corpus | Precision | Recall | F1 |
|---|---:|---:|---:|
| Synthetic | 99.4% | 80.5% | 88.9% |
| ai4privacy | 91.9% | 31.2% | 46.5% |
| Real pages | 100.0% | 69.2% | 81.8% |

Two production bugs were caught *only* by the disagreement:

- Textual date patterns scored **93.1% F1 on ai4privacy and 12.8% on real
  pages** — 257 false positives, precision 99.4% → 7.1%.
- The neural tagger scored **91.0% byte-level F1** on ai4privacy and flags
  **15.1% of ordinary page text** as PII.

Both have the same cause: form-shaped corpora are documents where nearly every
proper noun is personal data; real pages are prose where nearly none are.

Cost: three harnesses to maintain, and the real-page number varies run to run
because it harvests live pages (81.9% → 81.8% across two runs). Accepted — a
number that moves slightly and is honest beats a stable one that is not.
