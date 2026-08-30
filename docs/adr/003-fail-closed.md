# ADR-003 — Every failure path redacts rather than leaks

**Status:** Accepted · **Date:** 2026-08-30

## Context

Three separate defects were found where the scan silently produced *nothing* —
and producing nothing meant nothing was marked sensitive, so everything was
transmitted:

1. **Viewport culling.** `innerWidth`/`innerHeight` report 0 in hidden tabs and
   offscreen renders. Every element was judged offscreen and the scan returned
   nothing. Observed live: 3 elements present, 0 scanned, password undetected.
2. **Element cap.** The loop `break`-ed at `maxElements`, leaving sensitive
   elements later in a document unclassified — 120 of 803 on a real page.
3. **Tainted canvas.** `getImageData` throws `SecurityError` on cross-origin
   content; the unhandled throw aborted the entire redaction pass.

Each failed *open*. The system looked like it was working while transmitting
everything.

## Decision

Every failure path degrades toward redaction:

| Failure | Behaviour |
|---|---|
| Viewport size unknown | Skip culling, scan everything |
| Element budget exhausted | Classify all; cap only non-sensitive descriptors |
| Canvas masking throws | Black out the region |
| Vision budget exceeded | Emit `unscanned` at maximum severity |
| Vision model unavailable | Redact every visual candidate |

The invariant: **a slow or broken page loses picture quality and completeness,
never privacy.**

## Consequences

Wasted work is accepted — offscreen elements get scanned when the viewport is
unknown, and unscanned imagery is masked more aggressively than needed. Both
are cheap relative to a leak.

This principle was derived from failure, not foresight. All three defects
survived review and were caught only by executing the extension.
