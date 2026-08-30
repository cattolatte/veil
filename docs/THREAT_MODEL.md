# Threat model

Veil is a privacy control. A privacy control without a stated threat model is a
claim, not an engineering artifact — so this document says exactly what it
defends against, what it does not, and how each defence can fail.

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Credentials | Password fields, OTP fields | Account takeover |
| Government identifiers | Aadhaar, PAN, passport, licence | Identity theft; irrevocable |
| Financial identifiers | Card numbers, IFSC, UPI VPA | Direct financial loss |
| Contact data | Email, phone | Phishing, correlation |
| Biometric imagery | Faces in photos, ID scans | Irrevocable; often incidental |
| Behavioural context | Which page, which fields, in what order | Profiling |

## Trust boundary

```
TRUSTED                              │  UNTRUSTED
content script, page DOM, pixels     │  server, network, model host, logs
```

Everything left of the line sees raw values. Everything right of it must be
assumed to log, retain and be breached. The control is not "the server is
well behaved" — it is "the server never receives the value".

## In scope

**T1 — Passive server observation.** The server operator reads everything
received. *Mitigation:* only typed placeholders and structure cross the
boundary. Verified end-to-end with `secrets in payload: 0` on a page carrying
password, Aadhaar, PAN, IFSC, email and phone.

**T2 — Network interception.** *Mitigation:* the payload carries no secrets to
intercept. This is a property of the payload, not of the transport, and holds
even if TLS is stripped.

**T3 — Incidental capture.** A face or ID scan in an unrelated image on the
page. *Mitigation:* the vision pass masks faces; anything unscanned is redacted
wholesale rather than transmitted ([ADR-003](adr/003-fail-closed.md)).

**T4 — Silent degradation.** A code path fails and redaction quietly stops
while the system appears to work. **This is the most dangerous class**, and it
has occurred three times in this codebase — see ADR-003. *Mitigation:*
fail-closed on every path, plus an independent server-side leak audit so a
client failure is visible rather than silent.

**T5 — Over-redaction.** Masking so much that the agent cannot function, or the
user disables the tool. *Mitigation:* checksum verification and context
requirements; measured as precision, 20% of the rubric.

## Explicitly out of scope

Stating these is not evasion — an undefended surface that is *known* can be
reasoned about; one that is assumed defended cannot.

| Threat | Why out of scope |
|---|---|
| Malicious browser extension with equal privileges | It can read the DOM directly; Veil offers no defence and claims none |
| Compromised browser or OS | Below our trust boundary |
| A user pasting secrets into the agent's goal text | The goal string is user-authored and transmitted verbatim |
| Server-side model memorising placeholders | Placeholders are typed, not unique; there is nothing to memorise |
| Traffic analysis (page identity from timing/size) | Not addressed. Origin and path *are* transmitted |
| Side channels (cache, timing) | Not addressed |
| Rendered text inside images | **Known gap.** YuNet detects faces, not text. Mitigated only by wholesale masking of unscanned regions |

## Residual risks, ranked

1. **Canvas and image text.** An Aadhaar number rendered into a canvas is
   invisible to the DOM scan and undetected by a face detector. Measured
   recall: **0/58**. Currently mitigated only by fail-closed masking, which
   depends on the region being identified as a visual candidate at all.
2. **Unstructured PII.** Names and addresses have no pattern and no checksum.
   The architecture attempts 36.5% of PII types
   ([ADR-009](adr/009-neural-tagger-not-shipped.md)).
3. **Context-rule brittleness.** Hand-written rules decide whether an ambiguous
   string is PII. They were tuned by inspecting failures and will not
   generalise to distributions we have not tested
   ([ADR-006](adr/006-context-requirements.md)).
4. **Shadow DOM and cross-origin iframes.** Not traversed. PII inside them is
   neither detected nor transmitted — safe by accident, not by design.

## Invariants

These are the properties worth testing on every change:

1. No form field value ever appears in the transmitted payload.
2. Every text span matching a verified PII pattern is replaced before transmit.
3. Any visual region not successfully scanned is marked for redaction.
4. A failure in any detection path increases redaction; it never decreases it.
5. The server's independent audit finds no raw PII in inbound context.

**All five are automated** in `tests/invariants.test.mjs` and enforced on every
push and pull request. Invariants 3 and 4 were previously verified only by
inspection — which is how three fail-open defects reached `main`.

Writing them down as tests immediately found a fourth. `visualViewport?.width`
appears safe, but optional chaining does **not** guard an *undeclared* binding:
it throws `ReferenceError`. On any browser without `visualViewport`, the whole
scan would abort and redact nothing. Every global is now read off `globalThis`.
