# Architecture

## Trust boundary

```
   ┌──────────────────── CLIENT (trusted) ────────────────────┐
   │                                                          │
   │  content.js ── sees raw DOM, raw pixels, raw values       │
   │      │                                                    │
   │      ├─ lib/pii.js        structural + textual detection  │
   │      ├─ lib/redact.js     span redaction, canvas masking  │
   │      ├─ vision/engine.js  on-device ViT, budgeted         │
   │      └─ lib/serialize.js  builds sanitised context        │
   │                                                          │
   └───────────────────────────┬──────────────────────────────┘
                               │  sanitised context only
        ═══════════ TRUST BOUNDARY ═══════════
                               │
   ┌───────────────────────────▼──────────────────────────────┐
   │  server/main.py                                          │
   │    - validates schema                                     │
   │    - audits for leaked PII (defence in depth)             │
   │    - chooses an action                                    │
   └───────────────────────────┬──────────────────────────────┘
                               │  {type, index, text?}
                               ▼
                     content.js executes
```

## Detection: two passes, different trust

**Structural** — what an element *is*. `<input type=password>` is a password by
definition, so these are trusted outright. Near-zero false positives.

**Textual** — what an element *contains*. Regex alone over-fires badly: a bare
12-digit pattern flags order IDs as Aadhaar numbers. Every format carrying a
checksum is therefore verified — Verhoeff for Aadhaar, Luhn for cards. This is
the main lever on the 20% precision score.

Overlapping matches resolve by severity, then length, so a card number matched
as both `card` and `phone_in` redacts once, correctly.

## Redaction: spans, not elements

Blanking a whole paragraph because it held one email destroys precision. Only
the matched span is replaced, with a *typed* placeholder — the server learns
"a phone number belongs here" without learning the number.

## Budgets

Latency is 15% and client resource use is 20%, so the vision pass takes an
explicit `budgetMs`. On overrun it **fails closed**: unscanned imagery is
marked redacted rather than transmitted. Privacy never degrades under load;
only completeness does.

## Ground truth

No public dataset gives element-level labels for what should be masked on a
rendered web page. `datagen/` manufactures them: inject known PII into known
DOM nodes, screenshot, resolve each node's post-layout box. Labels are exact
by construction. Decoys that resemble PII but fail checksum are generated
deliberately, and verified to be true negatives, so precision numbers are honest.
