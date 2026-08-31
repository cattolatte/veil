"""
End-to-end checks on /act.

These exist because `choose_action` lost its `history` parameter in a silent
find-and-replace and shipped broken: every request on the DEFAULT path — no LLM
configured, rule planner answering — returned 500. Ten unit tests passed
throughout, because they exercised `validate()` rather than the endpoint.

A test that actually calls the endpoint would have caught it in seconds.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

BASE = {
    "schema": "veil/1", "url": "https://x.test/page", "title": "T",
    "viewport": {"w": 1280, "h": 800},
    "elements": [
        {"i": 0, "tag": "input", "type": "text", "label": "What went wrong?",
         "box": {"x": 0, "y": 0, "w": 10, "h": 10}, "state": {"filled": False, "length": 0}},
        {"i": 1, "tag": "input", "type": "password", "label": "",
         "box": {"x": 0, "y": 0, "w": 10, "h": 10}, "sensitive": "password",
         "placeholder": "[[PASSWORD]]", "state": {"filled": False, "length": 0}},
        {"i": 2, "tag": "button", "label": "Submit request",
         "box": {"x": 0, "y": 0, "w": 10, "h": 10}},
    ],
    "text": "Aadhaar [[AADHAAR]] ok", "redactionScheme": "typed-placeholder/[[KIND]]",
    "stats": {},
}

results = []


def check(label, ok):
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}")
    results.append(ok)


r = client.post("/act", json={"goal": "fill issue: card declined", "context": BASE})
check("the default rule-planner path returns 200", r.status_code == 200)
if r.status_code == 200:
    a = r.json()["action"]
    check("fills the empty non-sensitive field", a and a["type"] == "type" and a["index"] == 0)

r = client.post("/act", json={"goal": "fill password: hunter2", "context": BASE})
check("refuses to fill a password field", r.status_code == 200 and r.json()["action"] is None)

r = client.post("/act", json={"goal": "click submit request", "context": BASE})
check("clicks by label", r.status_code == 200 and r.json()["action"]["type"] == "click")

r = client.post("/act", json={
    "goal": "fill issue: card declined", "context": BASE,
    "history": [{"action": {"type": "type", "index": 0}, "reason": "already filled"}]})
check("history is accepted and not repeated",
      r.status_code == 200 and (r.json()["action"] or {}).get("index") != 0)

r = client.post("/act", json={"goal": "x", "context": {**BASE, "text": "A" * 40000}})
check("oversized text rejected", r.status_code == 422)

r = client.post("/act", json={"goal": "x", "context": BASE, "screenshot": "d" * 9_000_000})
check("oversized screenshot rejected", r.status_code == 422)

r = client.get("/planner")
check("planner endpoint reports which path is live", r.status_code == 200 and "llm_configured" in r.json())

r = client.get("/health")
check("health endpoint", r.status_code == 200)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
