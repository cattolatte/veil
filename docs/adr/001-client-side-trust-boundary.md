# ADR-001 — The server receives structure, never content

**Status:** Accepted · **Date:** 2026-08-30

## Context

`SIH26171` requires a browser agent that reasons about screen state without
exposing sensitive data to a server. The naive design sends a screenshot or the
DOM and lets a server-side model decide what matters. That fails the premise:
the sensitive data has already left the machine by the time anything decides it
was sensitive.

The rubric reinforces it. 40% of marks are PII detection and redaction
precision, both client-side properties. The server contributes 0% directly.

## Decision

The trust boundary sits inside the browser. The content script is the only
component that touches raw values. What crosses the boundary describes
*structure*:

- Form values are never transmitted — only `{filled: bool, length: int}`.
- Text is redacted span-wise into typed placeholders (`[[AADHAAR]]`).
- URLs are truncated to origin + path; query strings are dropped.
- Imagery is masked on-canvas before serialisation.

The redaction scheme is shared, so the server reasons about a field it can
never read: *"element 4 is `[[PASSWORD]]` and empty"* suffices to decide
"focus it and ask the user".

## Consequences

The server cannot do anything clever with content, because it has none. Action
selection works from labels, roles and geometry alone. A real capability limit,
accepted deliberately.

Defence in depth: the server independently audits inbound context for raw PII
using the same patterns as the generator, so a client-side failure surfaces in
the response rather than passing unnoticed.

Verified end to end — a full task ran with `secrets in payload: 0` while the
page carried a password, Aadhaar, PAN, IFSC, email and phone number.
