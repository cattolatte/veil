"""
Guard tests for the LLM planner.

The privacy guarantee must not depend on the model behaving well. These assert
that a badly-behaved or manipulated model cannot produce a harmful action.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import llm


class E:
    def __init__(self, i, sensitive=None):
        self.i = i
        self.sensitive = sensitive


class Ctx:
    def __init__(self):
        self.elements = [E(0), E(1, "password"), E(2, "autocomplete:cc-number")]


def check(action, expect, why):
    got = llm.validate(action, Ctx())
    ok = (got is not None) == expect
    print(f"  {'ok ' if ok else 'FAIL'}  {why}")
    return ok


print("LLM action validation:")
results = [
    check({"type": "click", "index": 0}, True, "click a normal element is allowed"),
    check({"type": "type", "index": 0, "text": "hi"}, True, "type into a normal field is allowed"),
    check({"type": "type", "index": 1, "text": "hunter2"}, False, "REFUSES to type into a password field"),
    check({"type": "type", "index": 2, "text": "4539"}, False, "REFUSES to type into a card field"),
    check({"type": "click", "index": 99}, False, "rejects an invented element index"),
    check({"type": "click"}, False, "rejects a missing index"),
    check({"type": "exfiltrate", "index": 0}, False, "rejects an unknown action type"),
    check({"type": "type", "index": 0, "text": 123}, False, "rejects a non-string text"),
    check({"type": "scroll", "dy": 400}, True, "scroll is allowed"),
    check("not a dict", False, "rejects a non-object reply"),
]
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
