"""
LLM/VLM action planner.

The problem statement asks that the anonymised context be sent to a
"centralized LLM/VLM, which successfully interprets the sanitized data and
returns... an UI action", and permits any offline-deployable open-weights model,
cloud-hosted during the event.

The client is therefore OpenAI-compatible, which is the interface Ollama,
vLLM, llama.cpp, LM Studio and TGI all expose. Point OPENAI_BASE_URL at a local
Ollama and nothing else changes — the deployment stays sovereign.

Two properties matter more than model quality here:

  1. The model never sees a secret. It receives typed placeholders and a
     screenshot whose sensitive pixels have already been destroyed. The prompt
     tells it what the placeholders mean so it can reason about a field it
     cannot read.
  2. It cannot invent an action. The reply is constrained to a small schema and
     validated against the element indices actually present; anything else is
     discarded in favour of the rule-based planner.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

SYSTEM = """You are the planning half of a privacy-preserving browser agent.

You never receive raw page content. Sensitive values are replaced by typed
placeholders before transmission, and sensitive screen regions are blacked out
before the screenshot is taken. Placeholders look like [[AADHAAR]], [[EMAIL]],
[[PASSWORD]]. Treat a placeholder as "a value of this type exists here"; you
cannot and should not try to recover it.

Given the goal and the sanitised context, reply with ONE action as JSON:

  {"type":"click","index":<int>,"reason":"..."}
  {"type":"type","index":<int>,"text":"...","reason":"..."}
  {"type":"scroll","dy":<int>,"reason":"..."}
  {"type":"noop","reason":"..."}

Rules:
- `index` must be one of the element indices provided. Never invent one.
- NEVER emit a `type` action targeting an element marked sensitive. If the goal
  requires filling one, return `noop` and say the user must do it themselves.
- Reply with the JSON object only. No prose, no code fence.
- If the goal is already achieved, return `noop`. That ends the run cleanly;
  inventing further actions to look busy is worse than stopping.
- Do not repeat an action listed as already done."""

ACTION_TYPES = {"click", "type", "scroll", "noop"}


def _describe(ctx: Any, limit: int = 60) -> str:
    """Compact, token-cheap rendering of the sanitised context."""
    lines = [f"URL: {ctx.url}", f"Title: {ctx.title}", "", "Elements:"]
    for e in ctx.elements[:limit]:
        bits = [f"[{e.i}] <{e.tag}"]
        if e.type:
            bits.append(f" type={e.type}")
        bits.append(">")
        if e.label:
            bits.append(f' "{e.label[:60]}"')
        if e.sensitive:
            bits.append(f"  SENSITIVE={e.sensitive}")
        if e.state:
            bits.append(f"  filled={e.state.get('filled')}")
        lines.append("".join(bits))
    lines += ["", "Page text (redacted):", ctx.text[:1500]]
    return "\n".join(lines)


def available() -> bool:
    return bool(os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_BASE_URL"))


def plan(goal: str, ctx: Any, screenshot: str | None = None,
         history: list | None = None) -> dict | None:
    """Ask the model for an action. Returns None on any failure — the caller
    falls back to the rule-based planner rather than surfacing an error."""
    if not available():
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None

    client = OpenAI(
        api_key=os.getenv("OPENAI_API_KEY", "not-needed-for-local"),
        base_url=os.getenv("OPENAI_BASE_URL") or None,
    )
    model = os.getenv("VEIL_MODEL", "gpt-4o-mini")

    past = ""
    if history:
        lines = [f"  {i+1}. {(h.action or {}).get('type','?')}"
                 f"{' @' + str((h.action or {}).get('index')) if (h.action or {}).get('index') is not None else ''}"
                 f" — {h.reason}" for i, h in enumerate(history)]
        past = "\n\nAlready done this run (do NOT repeat):\n" + "\n".join(lines)

    content: list[dict] = [{"type": "text", "text": f"Goal: {goal}{past}\n\n{_describe(ctx)}"}]
    if screenshot:
        # Already redacted client-side: the sensitive pixels no longer exist.
        content.append({"type": "image_url", "image_url": {"url": screenshot}})

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": content}],
            temperature=0,
            max_tokens=200,
        )
        raw = (resp.choices[0].message.content or "").strip()
    except Exception:
        return None

    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        return None
    try:
        action = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None

    return validate(action, ctx)


def validate(action: dict, ctx: Any) -> dict | None:
    """Reject anything the model should not have said.

    A planner that can name an arbitrary element index, or type into a password
    field, is a planner that can be talked into leaking. The privacy guarantee
    must not depend on the model behaving.
    """
    if not isinstance(action, dict) or action.get("type") not in ACTION_TYPES:
        return None

    by_index = {e.i: e for e in ctx.elements}
    if action["type"] in ("click", "type"):
        idx = action.get("index")
        if not isinstance(idx, int) or idx not in by_index:
            return None
        if action["type"] == "type" and by_index[idx].sensitive:
            return None            # never fill a sensitive field
        if action["type"] == "type" and not isinstance(action.get("text"), str):
            return None
    if action["type"] == "scroll" and not isinstance(action.get("dy", 0), int):
        return None
    return action
