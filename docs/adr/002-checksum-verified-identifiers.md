# ADR-002 — Verify structured identifiers by checksum

**Status:** Accepted · **Date:** 2026-08-30

## Context

Redaction precision is 20% of the score, graded separately from detection
recall. A detector that masks aggressively wins recall and loses precision.

Indian identifiers have shapes that collide badly with ordinary page content. A
bare 12-digit pattern matches order numbers, invoice references and timestamps.
Measured: roughly 1 in 10 uniformly random 12-digit strings pass the Aadhaar
checksum by chance, and the same holds for 16-digit strings under Luhn.

## Decision

Every format carrying a checksum is verified before being reported:

- **Verhoeff** for Aadhaar, plus the constraint that it never starts with 0 or 1
- **Luhn** for payment cards
- Structural constraints for PAN (4th character encodes holder type) and IFSC

Structural DOM signals — `<input type=password>`, `autocomplete="cc-number"` —
are trusted outright without further verification, because an element of that
type *is* that thing by definition.

## Consequences

Precision on structured identifiers is **95–100% across all three corpora**. On
real pages Aadhaar, IFSC, PAN and UPI all sit at 100%.

The cost is recall on malformed data: a mistyped Aadhaar fails its check digit
and is not masked. Accepted — a value failing its own checksum is more likely a
coincidence than a leak.

This also constrained the test data. Generator decoys are built by perturbing a
*valid* check digit, because uniformly random digits pass Luhn ~10% of the time
and would have been genuine card numbers mislabelled as negatives, silently
inflating the very metric they exist to measure.
