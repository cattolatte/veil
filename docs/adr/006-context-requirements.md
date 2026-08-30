# ADR-006 — Ambiguous patterns require corroborating context

**Status:** Accepted · **Date:** 2026-08-30

## Context

Some PII shapes are indistinguishable from ordinary content by pattern alone:

- `1234 5678 9012` is an Aadhaar number or a ticket reference. ~10% of grouped
  digit strings pass Verhoeff by chance.
- `17th February 1946` is a date of birth or a historical date. On real pages,
  overwhelmingly the latter.
- `6042580277` is an Indian mobile or a driver's licence number.

Measured consequence of ignoring this: textual date patterns produced **257
false positives across five real pages**, collapsing precision from 99.4% to
**7.1%**.

## Decision

Patterns that cannot self-verify require corroborating context within ~40
characters:

| Pattern | Requirement |
|---|---|
| Aadhaar, **separated** form | Nearby `aadhaar`, `uidai`, `uid`, `आधार`. Bare 12-digit runs pass on checksum alone. |
| Dates, all forms | Nearby `born`, `date of birth`, `D.O.B.`, `जन्म` |
| Indian mobile | *Absence* of a competing label (`Driver's License:`, `SSN:`) |
| `id_number` | *Presence* of such a label — the pattern is otherwise far too loose |

## Consequences

| Corpus | Before | After |
|---|---|---|
| Real pages | P 7.1% · F1 12.8% | **P 80.8% · F1 75.0%** |
| Synthetic | P 99.4% · F1 91.8% | P 99.4% · F1 88.9% |
| ai4privacy | P 91.2% · F1 58.9% | P 91.9% · F1 46.5% |

The ai4privacy cost is real and recorded, not hidden: `dob` recall falls
93.5% → 36.2%. It is partly an artifact — that corpus is plain text with no
DOM, so structural detection cannot contribute, whereas in the product a date
in an `autocomplete="bday"` field is caught structurally regardless of prose.

The trade is tuned for the deployment distribution: an agent browsing real
pages. The alternative was a detector that masks every date in every article.

**Known weakness.** These rules are hand-written and were tuned by inspecting
failures. A learned verifier over cheap features — token shape, entropy, nearby
label words, DOM position, checksum result — would set the boundary from data
instead of from judgement, in a few KB. Not yet built.
