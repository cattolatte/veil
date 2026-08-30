# ADR-007 — Group text by block ancestor before scanning

**Status:** Accepted · **Date:** 2026-08-30

## Context

The original text pass walked text nodes with a `TreeWalker` and scanned each
in isolation. PII split across inline elements therefore matched nothing:

```html
<span><em>2341</em><em>23412346</em></span>
```

Two text nodes, neither containing a complete Aadhaar number. Measured recall
on affected instances: **50%**.

Scanning the whole page as one concatenated string fixes that, but fuses
unrelated blocks — two adjacent numbers in separate table cells can join into a
false match.

## Decision

Group text fragments by their nearest **block-level ancestor**, then scan each
group. Inline elements are transparent; block elements are boundaries.

Both `perNode` and `joined` strategies remain in the evaluation harness
specifically so the cost of the naive approach stays visible rather than
disappearing behind friendlier preprocessing.

## Consequences

Split-case recall **50% → 100%** on the synthetic corpus, 87.9% on real pages
where markup is messier. Every text-detectable kind reached 100% recall on the
synthetic set.

Cost: **~3.5 ms of median latency** (10.6 → 14.1 ms) for **+10.4 points of
recall**. With detection at 20% and latency at 15%, clearly worth it — but it
is a real cost, not a free win.
