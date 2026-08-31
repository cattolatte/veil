"""
Veil server.

Receives ONLY sanitised context. Never sees raw page content, pixels, or form
values. Its job is to turn structure into an action.

The redaction scheme is shared, so the model can reason about a field it can
never read: "element 4 is [[PASSWORD]] and empty" is enough to decide "focus
it and ask the user", without the password ever existing on this side.
"""
from __future__ import annotations

import os
import re
from typing import Any, Literal

import llm
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Veil", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

PLACEHOLDER_RE = re.compile(r"\[\[[A-Z_]+\]\]")


class Box(BaseModel):
    x: int; y: int; w: int; h: int


class Element(BaseModel):
    i: int
    tag: str
    type: str | None = None
    role: str | None = None
    label: str = ""
    box: Box
    sensitive: str | None = None
    placeholder: str | None = None
    state: dict[str, Any] | None = None


class Context(BaseModel):
    schema_: str = Field("veil/1", alias="schema")
    url: str
    title: str = ""
    viewport: dict[str, Any]
    elements: list[Element]
    text: str = ""
    visualRedactions: list[dict[str, Any]] = []
    redactionScheme: str
    stats: dict[str, Any]

    model_config = {"populate_by_name": True}


class HistoryEntry(BaseModel):
    action: dict[str, Any] | None = None
    reason: str = ""


class ActRequest(BaseModel):
    goal: str
    context: Context
    # What the agent has already done this run. Without it the planner has no
    # memory and will repeat its first action forever - the classic way an
    # agent loop looks busy while achieving nothing.
    history: list[HistoryEntry] = []
    # Already redacted client-side: sensitive pixels were destroyed before
    # encoding, so this is safe to forward to a model.
    screenshot: str | None = None


class Action(BaseModel):
    type: Literal["click", "type", "scroll", "noop"]
    index: int | None = None
    text: str | None = None
    dy: int | None = None


class Plan(BaseModel):
    action: Action | None
    reason: str
    leaked: list[str] = []
    planner: str = "rules"


def audit_for_leaks(ctx: Context) -> list[str]:
    """
    Defence in depth. If raw PII reaches the server, the client failed and we
    want that visible in the demo rather than silently accepted.
    """
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "datagen"))
    try:
        from pii_patterns import find_pii  # shared with the generator
    except Exception:
        return []
    blob = " ".join([ctx.text, ctx.title] + [e.label for e in ctx.elements])
    return sorted({kind for kind, _ in find_pii(blob)})


def choose_action(goal: str, ctx: Context) -> Plan:
    """
    Baseline rule-based policy. Replaced by an open-weights VLM call, but kept
    as the fallback so the demo degrades instead of failing.
    """
    g = goal.lower()
    leaked = audit_for_leaks(ctx)
    history = history or []

    # Do not repeat something already done. The rule planner is stateless by
    # nature, so without this it re-fills a field it has already filled.
    done = {
        (h.action or {}).get("type", "") + str((h.action or {}).get("index", ""))
        for h in history if getattr(h, "action", None)
    }

    if "summar" in g:
        return Plan(action=Action(type="noop"), reason=f"Summarised {len(ctx.text)} redacted chars.", leaked=leaked)

    if "scroll" in g:
        return Plan(action=Action(type="scroll", dy=500), reason="Goal asks to scroll.", leaked=leaked)

    # Fill: pick the first empty non-sensitive text field.
    if any(k in g for k in ("fill", "type", "enter", "search")):
        for e in ctx.elements:
            if e.tag in ("input", "textarea") and not e.sensitive:
                if f"type{e.i}" in done:
                    continue                       # already filled this one
                if e.state and not e.state.get("filled"):
                    return Plan(
                        action=Action(type="type", index=e.i, text=goal.split(":")[-1].strip()),
                        reason=f"Filling empty field {e.i} ({e.label[:40] or e.type}).",
                        leaked=leaked,
                    )
        for e in ctx.elements:
            if e.sensitive:
                return Plan(action=None,
                            reason=f"Refusing: only remaining field {e.i} is {e.sensitive}. User must fill it.",
                            leaked=leaked)

    # Click: best keyword overlap against redacted labels.
    words = {w for w in re.findall(r"\w+", g) if len(w) > 2}
    best, score = None, 0
    for e in ctx.elements:
        if e.tag not in ("a", "button") and e.role not in ("button", "link"):
            continue
        label = PLACEHOLDER_RE.sub(" ", e.label).lower()
        overlap = len(words & set(re.findall(r"\w+", label)))
        if overlap > score:
            best, score = e, overlap
    if best and f"click{best.i}" not in done:
        return Plan(action=Action(type="click", index=best.i),
                    reason=f"Clicking {best.i} ({best.label[:40]}), {score} keyword match(es).", leaked=leaked)

    return Plan(action=Action(type="noop"), reason="No confident action.", leaked=leaked)


@app.post("/act", response_model=Plan)
def act(req: ActRequest) -> Plan:
    """Prefer the LLM/VLM; fall back to rules so the demo degrades instead of
    failing. The fallback is not a placeholder — a planner that always answers
    is worth more on stage than one that is occasionally smarter."""
    leaked = audit_for_leaks(req.context)

    llm_action = llm.plan(req.goal, req.context, req.screenshot, req.history)
    if llm_action:
        kind = llm_action.pop("type")
        reason = llm_action.pop("reason", "")
        return Plan(
            action=Action(type=kind, **{k: v for k, v in llm_action.items()
                                        if k in {"index", "text", "dy"}}),
            reason=reason or "planned by model",
            leaked=leaked,
            planner=f"llm:{os.getenv('VEIL_MODEL', 'gpt-4o-mini')}",
        )

    plan = choose_action(req.goal, req.context, req.history)
    plan.planner = "rules" if not llm.available() else "rules (model unavailable)"
    return plan


@app.get("/planner")
def planner() -> dict[str, object]:
    """Which planner is live. Useful on stage: it makes the LLM path visible
    rather than something the audience takes on trust."""
    return {
        "llm_configured": llm.available(),
        "model": os.getenv("VEIL_MODEL", "gpt-4o-mini"),
        "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
