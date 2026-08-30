# ADR-011 — An LLM/VLM plans; validation decides what is allowed

**Status:** Accepted · **Date:** 2026-08-30

## Context

The problem statement requires

> transmission of the anonymized visual context to a centralized LLM/VLM, which
> successfully interprets the sanitized data and returns... an UI action

and permits any offline-deployable open-weights model, cloud-hosted during the
event.

Our server was rule-based. That satisfied the *demo* requirement — an end-to-end
task ran — but not the stated architecture.

## Decision

An OpenAI-compatible client, because that is the interface Ollama, vLLM,
llama.cpp, LM Studio and TGI all expose. Pointing `OPENAI_BASE_URL` at a local
Ollama changes nothing else, so the deployment stays sovereign — which is the
spirit of a problem statement about not sending data away.

The model receives the sanitised context: typed placeholders and a screenshot
whose sensitive pixels were destroyed client-side. The system prompt explains
the redaction scheme, so it can reason about a field it cannot read.

**Every reply is validated before it becomes an action.** The model may not:

- name an element index that does not exist,
- emit an action type outside `{click, type, scroll, noop}`,
- **type into any element marked sensitive.**

Anything failing validation is discarded and the rule-based planner answers
instead.

## Consequences

The privacy guarantee does not depend on the model behaving. A model that is
confused, poorly aligned, or prompt-injected by page content still cannot type
into a password field, because the server refuses the action rather than
trusting the reply. Ten guard tests assert this, enforced in CI.

The rule-based planner is retained as a fallback, not as a placeholder: a
planner that always answers is worth more on stage than one that is
occasionally smarter. `GET /planner` reports which path is live, so the LLM
integration is visible rather than taken on trust.

Cost: an external dependency and a network hop on the server side. Neither
touches the client metrics, which are the ones scored.
