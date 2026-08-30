"""
PII patterns, shared between the generator and the server-side leak audit.

Mirrors extension/src/lib/pii.js. Kept in sync deliberately: the generator must
label exactly what the extension is expected to catch, or the metrics lie.
"""
from __future__ import annotations

import re

VERHOEFF_D = [
    [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
    [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
    [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
    [9,8,7,6,5,4,3,2,1,0],
]
VERHOEFF_P = [
    [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
    [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
    [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
]
VERHOEFF_INV = [0,4,3,2,1,5,6,7,8,9]


def verhoeff_check(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = VERHOEFF_D[c][VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def verhoeff_digit(payload: str) -> str:
    """Check digit for an 11-digit Aadhaar body."""
    c = 0
    for i, ch in enumerate(reversed(payload)):
        c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][int(ch)]]
    return str(VERHOEFF_INV[c])


def luhn_check(digits: str) -> bool:
    total, dbl = 0, False
    for ch in reversed(digits):
        n = int(ch)
        if dbl:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        dbl = not dbl
    return total % 10 == 0


def luhn_digit(payload: str) -> str:
    total, dbl = 0, True
    for ch in reversed(payload):
        n = int(ch)
        if dbl:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        dbl = not dbl
    return str((10 - total % 10) % 10)


PATTERNS: list[tuple[str, re.Pattern[str], object]] = [
    ("aadhaar", re.compile(r"\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b"),
     lambda m: verhoeff_check(re.sub(r"[\s-]", "", m))),
    ("card", re.compile(r"\b(?:\d[ -]?){13,19}\b"),
     lambda m: luhn_check(re.sub(r"[\s-]", "", m))),
    ("pan", re.compile(r"\b[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]\b"), None),
    ("ifsc", re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b"), None),
    ("upi", re.compile(r"\b[\w.\-]{2,}@(?:oksbi|okhdfcbank|okicici|okaxis|paytm|ybl|ibl|axl|upi)\b", re.I), None),
    ("email", re.compile(r"\b[\w.+\-]+@[\w\-]+\.[\w.\-]{2,}\b"), None),
    ("phone_in", re.compile(r"(?:\+?91[\s-]?)?\b[6-9]\d{9}\b"), None),
    ("dob", re.compile(r"\b(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:19|20)\d{2}\b"), None),
]


def find_pii(text: str) -> list[tuple[str, str]]:
    """Return [(kind, matched_text)], checksum-verified where applicable."""
    out: list[tuple[str, str]] = []
    for kind, rx, verify in PATTERNS:
        for m in rx.finditer(text or ""):
            if verify and not verify(m.group(0)):
                continue
            out.append((kind, m.group(0)))
    return out
