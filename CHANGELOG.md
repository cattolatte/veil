# Changelog

Measured against the `SIH26171` rubric: visual context 25%, PII detection 20%,
redaction precision 20%, client resource use 20%, latency 15%.

## [Unreleased]

Nothing outstanding. The next work is listed in the guide's
[extending](https://github.com/cattolatte/veil-guide) chapter.

## [v0.26.0-beta] — Multi-step loop, neural PII channel, settings, history

- **Multi-step agent loop.** Perceive, plan, act, up to 8 steps. Stops on
  `noop`, a failed action, a repeated action, or the ceiling. Every step
  re-perceives from scratch; the server receives action history so neither
  planner repeats itself.
- **Neural PII channel shipped**, past the ~36.5% pattern ceiling. Three fixes
  were needed: real-prose negatives took over-firing from **15.1% to 0.0%**; a
  0.90 confidence threshold fixed over-firing on UI chrome (18 finds → 6, zero
  UI words redacted); and `int32` input plus batched block scanning took the
  pass from **1,623 ms to ~10 ms**.
- Raw text for the neural pass is retained non-enumerably and deleted before
  serialisation, with an invariant test asserting it cannot leak.
- Popup rewritten: light/dark, per-step reporting, settings, 20-run history.
- Store packaging: allowlisted zip, listing copy, permission justifications.
- **26 tests.**

## [v0.25.0-beta] — The screen pipeline was never connected

The screen model was trained, exported, benchmarked at 90.1% F1 on 910 held-out
real pages — and **not imported by anything**. `screen-capture.js` and
`fuse.js` existed and were never called, for two milestones, while every unit
test passed because every unit worked.

`tests/wiring.test.mjs` now asserts the wiring itself: the pipeline is imported
and called, fusion is applied, only the redacted frame is assigned for
transmission, and the error path assigns no screenshot.

## [v0.24.0-beta] — Screen model F1 90.1%

Retrained on 2,730 real pages. F1 84.1% → **90.1%**, precision 87.6% → 92.8%,
held-out set 127 → **910 pages**.

**The architecture never changed across five training rounds.** 117 real pages
bought twelve points over synthetic-only, 384 bought twelve more, 2,730 bought
six. Every gain came from data.

## [v0.23.0-beta] — Screen model F1 84.1%, DOM fusion

Real-page F1 72.2% → 84.1%. Threshold 0.9 → 0.95, tie broken on precision.
Adds DOM–screen fusion: the DOM arbitrates where it can account for a region,
the screen model stands where the DOM is blind, `unscanned` is never suppressed.

## [v0.22.0-beta] — Screen perception and LLM/VLM planner

Closes the two PS requirements we were not meeting: a local vision model that
reads the screen, and transmission to a centralised LLM/VLM.

Screen perception: convolutional encoder, 435,297 parameters, 1.7 MB ONNX,
WebGPU. Trained on the generator alone it scored 99.8% on its own split and
**12.5% on real pages, flagging half the screen** — it had learned where PII
sits on one template.

LLM planner: OpenAI-compatible, so a local Ollama needs one environment
variable. Every reply validated — the model cannot name a nonexistent element,
emit an unknown action, or type into a sensitive field. Ten guard tests.

## [v0.21.1-beta] — Straddling spans redacted, not dropped

A match beginning in the cross-block prefix and ending inside the block was
filtered away entirely, leaving its tail transmitted in the clear. Now clamped.
A fail-open introduced by a feature, on the path built to prevent fail-open.

## [v0.21.0-beta] — Hosted demo, README, repository metadata

Demo published to GitHub Pages, publishing only `demo/` with an allowlist and a
guard step. Note that a Pages site is public even when the repository is
private.

## [v0.20.0-beta] — Demo redesign

Responsive from 375px, light and dark via `prefers-color-scheme`, accessible
focus states. The demo bundle is staged by the build rather than committed, so
it cannot drift from source.

## [v0.19.0-beta] — Live demo, and two bugs it found

Neither was visible to any of the three corpora:

- Block grouping inserted whitespace not present in the rendered text, so
  `<em>2341</em><em>23412346</em>` became `"2341 23412346"` and stopped
  matching.
- Labels and values sit in *sibling* blocks, so context-requiring patterns never
  saw the label.

`eval/detect.mjs` reimplements text extraction while the product uses
`serialize.js` over a live DOM — the harness validates the patterns, not the
pipeline.

## [v0.18.1-beta] — Model size corrected: 403 KB, not 18 KB

The exporter wrote weights to a `.onnx.data` sidecar, leaving an 18 KB graph
file reported as the model size. Wrong by 22×, across four documents. Caught by
a CI hygiene check written for an unrelated purpose.

## [v0.18.0-beta] — Privacy invariants automated, CI

The threat model listed five invariants and admitted two were verified only by
inspection. Writing them as tests immediately found a fourth bug:
`visualViewport?.width` throws `ReferenceError` on an **undeclared** binding —
optional chaining does not guard that — aborting the scan and redacting nothing.

## [v0.17.0-beta] — Threat model, model cards, metrics, provenance

A privacy control without a stated threat model is a claim, not an engineering
artifact. Five threat classes in scope, seven explicitly out. Model cards note
that YuNet's training data has documented demographic imbalance, which for a
detector whose miss means failure to mask is a fairness-relevant privacy risk we
have not measured.

## [v0.16.0-beta] — Architecture decision records and README

## [v0.15.0-beta] — Character-level PII tagger, and why it was not shipped then

100,169 parameters, 403 KB, 91.0% byte-level F1 — and flagged **15.1% of
ordinary page text**. Same failure as the date patterns: ai4privacy is
form-shaped, real pages are prose.

## [v0.14.0-beta] — Corrected the real-page harness

Real-page precision read 79.5% with 40 false positives. **All 40 were genuine
PII already on those pages** — python.org and gnu.org publish real contact
addresses. Precision 79.5% → **100%**. We were penalising the detector for being
right.

## [v0.12.0-beta] — End-to-end loop and on-device face detection

**First complete task, and the first working vision pass.**

### End to end

Capture → sanitise → server → action → executed, against the live FastAPI
server on a real page:

```
field before: ""
field after:  "my card was declined"
task succeeded: true      secrets in payload: 0
capture 12.1 ms · server 18.8 ms · total 33 ms
```

Safety behaviour verified in the same loop: asked to fill a password, the
server refuses and the field stays empty. Asked to click by label, it resolves
the right control. What the server actually receives:

```
Aadhaar [[AADHAAR]] · PAN [[PAN]] · IFSC [[IFSC]]
Registered email [[EMAIL]], mobile [[PHONE]]
Reference ORDER-100000000000 · ticket 1234 5678 9012
```

Every real identifier masked, both decoys untouched, password sent as
`{filled: false, length: 0}`.

### Vision — canvas recall is no longer structurally 0%

YuNet (**227 KB**) wired in through ONNX Runtime Web on WebGPU. Chosen for
size: with 20% of the score on resource use and 15% on latency, a small
purpose-built detector beats a large general model. UGround-V1 was considered
and rejected — 424 GB of gated training data for a model far too heavy to run
in a browser.

Detected **12 faces** across two test images in-browser, exactly matching an
independent Python run of the same model (1 + 11). Cold 447 ms including model
load, warm 134 ms, heap 9.9 MB, zero regions falling back to `unscanned`.

Two defects found by running it:

- ORT resolves its loader as a module specifier, so a relative `wasmPaths`
  throws before any backend initialises. Must be an absolute URL.
- The WebGPU build loads the `asyncify` runtime, not `jsep`. Shipping only
  `jsep` fails with a misleading "no available backend found".

Element references are now carried on visual candidates instead of recovering
them with `elementFromPoint`, which picks the wrong node under overlap and
shifts with scroll. They never leave the client.

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
