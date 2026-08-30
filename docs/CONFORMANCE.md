# Conformance to SIH26171

Every requirement stated in the problem statement, and where it is implemented.

## Client-side

| Requirement (verbatim) | Where | Status |
|---|---|---|
| "client side extension … running in popular browsers (chrome, Firefox)" | `extension/manifest.json`, `manifest.firefox.json` | ✅ |
| "a local Vision Transformer (ViT) or equivalent computer vision model 'reads' the user's screen" | `vision/model.py`, `extension/src/vision/screen.js` | ✅ |
| "client-side vision model running in the browser (e.g., via WebGPU) that evaluates the current screen state" | `screen.js` — ORT Web, WebGPU with WASM fallback | ✅ |
| "sanitize the sensitive/PII data using DOM tags or any other method, before any network request is made" | `lib/pii.js` structural + `lib/serialize.js` | ✅ |
| "dynamically detect and redact sensitive elements" | `lib/redact.js` | ✅ |
| "blurring faces" | `vision/engine.js` — YuNet | ✅ |
| "blacking out passwords" | structural detection → `[[PASSWORD]]`, value never sent | ✅ |
| "masking PII" | span-level typed placeholders | ✅ |
| "local bounding-box redaction, semantic obfuscation, masking" | box redaction on canvas + placeholder substitution | ✅ |
| "This should be clearly demonstrated" | `demo/` — live at cattolatte.github.io/veil | ✅ |
| "Only this anonymized, unidentifiable data should be transmitted" | invariant tests 1, 2, 5 | ✅ |

## Server-side

| Requirement (verbatim) | Where | Status |
|---|---|---|
| "transmission of the anonymized visual context to a centralized LLM/VLM" | `server/llm.py` | ✅ |
| "which successfully interprets the sanitized data" | system prompt explains the redaction scheme | ✅ |
| "returns … an UI action (e.g., 'click the submit button,' 'scroll down')" | `click` / `type` / `scroll` / `noop` | ✅ |
| "that the local client executes" | `content.js` `execute()` | ✅ |
| "any offline deployable (open-source/open-weights) model … cloud hosted version during SIH" | OpenAI-compatible: Ollama, vLLM, llama.cpp | ✅ |
| "An end-to-end task assisting the user should be demonstrated" | field filled end to end, 33 ms, 0 leaks | ✅ |
| "server … should be aware for this redaction scheme" | scheme declared in payload and in the prompt | ✅ |

## Stated design constraint

| Requirement | Status |
|---|---|
| "Participants must balance the trade-offs between inference latency and the accuracy" | DOM pass 8.9 ms always; screen pass ~160 ms on demand; documented in [ADR-010](adr/010-screen-perception.md) |

## Evaluation metrics

| # | Metric | Weight | Measured |
|---|---|---:|---|
| 1 | Accuracy of visual context from screen | 25% | DOM structural capture + screen model **F1 84.1%** on 127 held-out real pages |
| 2 | Recall & precision, PII detection | 20% | Real pages **P 100%**, text recall **92.5%** |
| 3 | Precision of redaction | 20% | Real pages **100%**, 0 false positives |
| 4 | Client resource utilisation | 20% | **3.1 MB** heap (DOM pass); models 227 KB + 1.7 MB |
| 5 | End-to-end latency | 15% | **8.9 ms** capture · **33 ms** full round trip |

**Nothing in the problem statement is unimplemented.** What remains is quality,
not coverage — see [vision/README.md](../vision/README.md) for the screen
model's precision ceiling and the data that would raise it.
