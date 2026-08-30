# Changelog

Measured against the `SIH26171` rubric: visual context 25%, PII detection 20%,
redaction precision 20%, client resource use 20%, latency 15%.

## [Unreleased]

Not yet addressed: on-device vision model (25%), client resource measurement
(20%), latency measurement (15%). The extension has not yet been run in a real
browser.

## [v0.6.0-beta] — Evaluation harness and data strategy

- Rubric-aligned scorer for detection and redaction.
- Predictions matched per-instance by value, correcting a scorer bug that
  reported 56.7% canvas recall where the true figure is 0%.
- `--no-screenshots` generator mode: harness runs with no browser install.
- **Baseline: precision 98.1%, recall 74.8%, F1 84.9%** (text pass only).
- Canvas recall 0%, split-case recall 50%.

## [v0.5.0-beta] — Synthetic data generation

- Playwright + Faker generator with exact ground truth by construction.
- Hard cases generated deliberately: inline-split PII, canvas-rendered PII.
- Decoys built by perturbing a valid check digit — verified zero true positives
  across 800 samples. The prior 16-random-digit decoy passed Luhn ~10% of the
  time, which would have inflated precision.

## [v0.4.0-beta] — Server and action policy

- FastAPI service with a strict sanitised-context schema.
- Independent inbound leak audit, so a client-side failure is visible.
- Refuses to fill sensitive fields.

## [v0.3.0-beta] — Extension runtime

- Content script, service worker, popup, on-device vision interface.
- Vision pass runs under a time budget and fails closed: unscanned imagery is
  redacted, never transmitted.
- Debug overlay draws what would be redacted.

## [v0.2.0-beta] — PII detection and redaction engine

- Two-pass detection: structural signals trusted, textual matches
  checksum-verified. Verhoeff for Aadhaar, Luhn for cards.
- Indian formats covered specifically: Aadhaar, PAN, IFSC, UPI, +91 mobile.
- Span-level redaction with typed placeholders.

## [v0.1.0-alpha] — Scaffold

- Chrome MV3 and Firefox manifests, architecture notes, project layout.
