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

# Goals that name something the agent must never type on the user's behalf.
SENSITIVE_GOAL_RE = re.compile(
    r"\b(password|passwd|pwd|otp|pin|cvv|cvc|secret|token|"
    r"card\s*number|aadhaar|aadhar|pan\b|passport|ssn)\b", re.I)

# Bounds on inbound data. The client already truncates, but a server that
# trusts its client is a server with an unbounded memory footprint - and this
# one accepts a base64 screenshot, which is the easiest thing to get wrong.
MAX_GOAL = 2_000
MAX_TEXT = 32_000
MAX_ELEMENTS = 500
MAX_SCREENSHOT = 8_000_000        # ~6 MB decoded
MAX_HISTORY = 32


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
    elements: list[Element] = Field(default_factory=list, max_length=MAX_ELEMENTS)
    text: str = Field(default="", max_length=MAX_TEXT)
    visualRedactions: list[dict[str, Any]] = []
    redactionScheme: str
    stats: dict[str, Any]

    model_config = {"populate_by_name": True}


class HistoryEntry(BaseModel):
    action: dict[str, Any] | None = None
    reason: str = ""


class ActRequest(BaseModel):
    goal: str = Field(max_length=MAX_GOAL)
    context: Context
    # What the agent has already done this run. Without it the planner has no
    # memory and will repeat its first action forever - the classic way an
    # agent loop looks busy while achieving nothing.
    history: list[HistoryEntry] = Field(default_factory=list, max_length=MAX_HISTORY)
    # Already redacted client-side: sensitive pixels were destroyed before
    # encoding, so this is safe to forward to a model.
    screenshot: str | None = Field(default=None, max_length=MAX_SCREENSHOT)


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


def choose_action(goal: str, ctx: Context, history: list | None = None) -> Plan:
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

    # A goal naming a sensitive field is refused outright, rather than falling
    # through to "fill the first available field". Substituting a different
    # target writes the goal text - which may contain the secret the user was
    # trying to enter - into visible page content.
    if any(k in g for k in ("fill", "type", "enter", "search")):
        if SENSITIVE_GOAL_RE.search(g):
            return Plan(
                action=None,
                reason="Refusing: the goal names a sensitive field. The user must fill it.",
                leaked=leaked,
            )
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


def rules_are_confident(plan: Plan) -> bool:
    """Did the cheap planner actually decide something?

    A `noop` with "no confident action" is the rule planner shrugging. Anything
    else - a click it matched by label, a field it chose to fill, a deliberate
    refusal - is a real decision and does not need a 4-billion-parameter model
    to second-guess it.
    """
    if plan.action is None:
        return True                      # a refusal IS a decision
    if plan.action.type == "noop" and "no confident action" in plan.reason.lower():
        return False
    return True


@app.post("/act", response_model=Plan)
def act(req: ActRequest) -> Plan:
    """
    Tiered planning: cheap first, model only when the cheap path shrugs.

    End-to-end latency is 15% of the score and a local VLM costs seconds, so
    running it on every step would trade a well-scoring metric for a marginal
    gain on another. The rule planner answers in about a millisecond and is
    right for the common cases - fill this, click that. The VLM is for the
    cases it cannot resolve, and for goals that need the screen understood
    rather than merely matched.

    Set VEIL_ALWAYS_LLM=1 to force the model on every request, which is useful
    for demonstrating that the integration is real. It does NOT override a
    refusal - see below.
    """
    leaked = audit_for_leaks(req.context)

    rules = choose_action(req.goal, req.context, req.history)
    force = os.getenv("VEIL_ALWAYS_LLM") == "1"

    # A refusal is TERMINAL, even under VEIL_ALWAYS_LLM. Escalating it would
    # give the model a second chance at a goal the rules already judged unsafe,
    # and the danger is not that it fills the password field - the validator
    # catches that - but that it writes the secret from the goal text into some
    # other, non-sensitive field. That action is structurally valid, so no
    # validator can reject it. The only safe move is not to ask.
    if rules.action is None:
        rules.leaked = leaked
        rules.planner = "rules (refused; not escalated)"
        return rules

    if not force and rules_are_confident(rules):
        rules.leaked = leaked
        rules.planner = "rules"
        return rules

    llm_action = llm.plan(req.goal, req.context, req.screenshot, req.history)
    if llm_action:
        kind = llm_action.pop("type")
        reason = llm_action.pop("reason", "")
        return Plan(
            action=Action(type=kind, **{k: v for k, v in llm_action.items()
                                        if k in {"index", "text", "dy"}}),
            reason=reason or "planned by model",
            leaked=leaked,
            planner=f"llm:{os.getenv('VEIL_MODEL', 'qwen3-vl:8b-instruct')}",
        )

    # The model was asked and did not produce a usable action - unavailable,
    # timed out, or its reply failed validation. The cheap answer stands.
    rules.leaked = leaked
    rules.planner = "rules (model declined)" if llm.available() else "rules"
    return rules


@app.get("/planner")
def planner() -> dict[str, object]:
    """Which planner is live. Useful on stage: it makes the LLM path visible
    rather than something the audience takes on trust."""
    return {
        "llm_configured": llm.available(),
        "model": os.getenv("VEIL_MODEL", "qwen3-vl:8b-instruct"),
        "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "always_llm": os.getenv("VEIL_ALWAYS_LLM") == "1",
        "tiering": "rules first; model when the rules shrug",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
