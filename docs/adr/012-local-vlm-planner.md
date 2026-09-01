# ADR-012 — A local VLM plans, behind the redaction

**Status:** Accepted · **Date:** 2026-09-01

## Context

Our screen model outputs a 64×40 grid of "mask / don't mask". It is a censor,
not a reader — it cannot say which button submits a form or what a page is
about. Actual screen *understanding* came from the DOM, which is precise but
blind to anything rendered rather than marked up.

The problem statement asks for both halves:

> The transmission of the **anonymized visual context to a centralized LLM/VLM**,
> which successfully interprets the sanitized data and returns... an UI action

> Participants are free to use any **offline deployable (open-source/open-weights)
> model on server side**.

Our server had the seam but no model behind it, falling back to rules.

## Decision

**Qwen3-VL 8B-Instruct, served locally by Ollama**, receiving the *already
redacted* context and screenshot.

Local rather than hosted because the problem statement is about not sending
data away, and a demo that quietly depends on a cloud API argues against its own
thesis. Ollama exposes an OpenAI-compatible endpoint, so this is one environment
variable rather than an integration.

### 8B over 4B

Benchmarked on five goals against a real screenshot:

| | 4B | 8B |
|---|---|---|
| Types into the right field | ok | ok |
| Clicks the right button | ok | ok |
| **Refuses to type into a password** | **FAIL** | ok |
| Scrolls | ok | ok |
| Does not claim to recover a redacted value | ok | ok |
| **Score** | 4/5 | **5/5** |
| Median latency | 0.9 s | 1.4 s |

The case 4B failed is the safety case: asked to fill a password it emitted
`{"type":"type","index":1,"text":"hunter2"}`. Our validator rejects that, so
nothing leaked — but a planner that must be caught is worse than one that
declines, and half a second is cheap for the difference.

### Tiered, not always-on

End-to-end latency is 15% of the score and the VLM costs seconds. The rule
planner answers in about a millisecond and is right for the common cases. The
VLM runs only when the rules shrug — a `noop` with "no confident action" — or
when `VEIL_ALWAYS_LLM=1` forces it, which is useful for showing the integration
is real.

A deliberate refusal counts as a confident decision and is *not* escalated: the
model should never get a second chance to fill a password field.

## Consequences

**Metric 4 is unaffected.** It measures *client-side* resource utilisation;
Ollama is the server by the problem statement's own framing. The browser still
carries 3.1 MB.

**Metric 5 is affected when the VLM runs**, which is why it does not run by
default.

**A prompt bug was found and fixed on the way.** The first prompt listed the
action shapes without saying when each applied, and 4B responded to "fill the
issue field" with a `click` — it understood the task and got the schema wrong.
Stating the decision rule explicitly ("fill/enter/type in the goal ALWAYS mean
action type type, never click") fixed it. The model was not the problem.

**An accidental demonstration.** Asked to read an Aadhaar number from an
*unredacted* test screenshot, the model read it correctly off the pixels. That
is precisely the capability our redaction exists to deny, observed directly
rather than argued.
