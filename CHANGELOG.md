# Changelog

Measured against the `SIH26171` rubric: visual context 25%, PII detection 20%,
redaction precision 20%, client resource use 20%, latency 15%.

## [Unreleased]

Not yet addressed: on-device vision model (25%). Corpus is still 60 synthetic
pages with no screenshots and no real-world layout.

## [v0.10.0-beta] — Robustness and performance

**Warm median 14.1 ms → 8.9 ms. First run 35.4 ms → 22.3 ms. Element phase
8.8 ms → 5.7 ms.** Detection unchanged at F1 91.8%.

Six defects fixed:

- **Duplicated element selector.** `INTERACTIVE` was defined in serialize.js
  and retyped in content.js. Any drift would shift every index and click the
  wrong control, silently. Both now import one shared constant.
- **Tainted-canvas crash.** `getImageData` throws SecurityError on a canvas
  holding cross-origin content, which aborted the redaction pass and let the
  frame through unmasked. Every failure path now falls back to a blackout.
- **Popup hung forever** on browser-internal pages, where no content script
  exists. The rejection never reached `respond()`. Now caught and reported.
- **Unbounded server fetch.** A dead server hung the popup instead of
  reporting a number, on a metric worth 15%. Now aborts at 8 s, with an
  overall 30 s ceiling.
- **Framework-controlled inputs ignored typing.** Assigning `el.value`
  bypasses React's value tracker, so it re-renders the old value straight
  back. Now uses the prototype setter and fires input + change.
- **Firefox API mismatch.** Callback-style `chrome.*` is unreliable there;
  everything goes through a promise-based shim.

Two optimisations:

- `getBoundingClientRect` was computed twice per element — once to test
  visibility, again to record the box. Now measured once and passed through.
- `Element.checkVisibility()` replaces `getComputedStyle()` where available;
  the engine answers it from internal state.

Note on methodology: the earlier 14.1 ms median included cold runs. The
directly comparable figure is first-run, 35.4 ms → 22.3 ms.

## [v0.9.0-beta] — Recall, precision and cost instrumentation

**Detection F1 84.9% → 91.8%. Recall 74.8% → 85.2%. Precision 98.1% → 99.4%.**

- **Inline-split recall 50% → 100%.** Text is now grouped by nearest
  block-level ancestor before scanning, rejoining PII spread across inline
  elements without fusing unrelated blocks. Every text-detectable kind
  (card, dob, email, ifsc, pan, phone, upi) now sits at 100% recall.
- **Aadhaar false positives 5 → 2.** Separated form (`1234 5678 9012`) collides
  with ticket and invoice references, ~1 in 10 of which pass Verhoeff by
  chance. Bare 12-digit runs still pass on checksum alone; separated ones now
  additionally require a nearby identifying label.
- **Cost instrumentation.** Phase timings and heap usage are recorded in the
  pipeline, so a regression shows up immediately rather than at measurement
  time. Rolling median and p95 helpers, because first-run figures include lazy
  init and should never be the quoted number.

Measured on a real 3,100-node page:

```
median 14.1 ms   p95 35.4 ms   heap 3.3 MB   payload 21.6 KB
phases: elements 8.8 ms · visual 0.3 ms · text 5.1 ms
split-across-elements Aadhaar caught · 0 secrets leaked · decoys untouched
```

Block grouping costs ~3.5 ms of median latency for +10.4 points of recall.

## [v0.8.0-beta] — Bundled content script; two fail-open bugs fixed

First execution in a real browser. Three defects found, all of which would
have survived to the finale:

- **MV3 content scripts cannot use ES module `import`.** They are classic
  scripts, so `content.js` failed at parse time and the extension never ran.
  Now bundled to a single IIFE with esbuild.
- **Viewport culling failed open.** `innerWidth`/`innerHeight` report 0 in
  hidden tabs, offscreen renders and early load. Every element was then judged
  offscreen, the element scan returned nothing, and nothing was marked
  sensitive. Culling is now skipped when viewport size is unknown.
- **The element cap failed open.** The scan broke out at `maxElements`, so a
  password field later in a long document was never classified. On a real page
  that meant 120 of 803 elements examined. All elements are now classified;
  only non-sensitive descriptors are capped.

**Measured on a real 3,097-node page, 803 interactive elements:**

```
median latency   10.6 ms
payload          21.5 KB
scanned          775 / 803   (28 not visible)
secrets leaked   0
index mismatches 0
```

Detection unchanged: precision 98.1%, recall 74.8%, F1 84.9%.

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
