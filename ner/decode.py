"""
Span decoding for byte-level tags.

Raw argmax gives ragged spans - a name comes back as 'Shar'+'ma'. The model is
reliable about roughly WHERE the PII is and noisy about exact edges, which is
what byte-level tagging without a CRF gives you.

B/I prefixes are discarded and only the CLASS is kept per byte. Boundary noise
lives almost entirely in the B-vs-I decision, and for redaction the distinction
is worthless: we mask the whole entity either way. Dropping it removes the
overlapping-span problem at the source rather than repairing it afterwards.

For redaction, extent matters far more than class. A name mislabelled as an
address is still masked correctly; a mask that stops halfway through leaks.
"""
from __future__ import annotations

import re

WORD = re.compile(rb"[A-Za-z0-9_@.\-]")
GAP = re.compile(rb"^[ \t,;:]{1,2}$")


def decode(tag_ids, tags, raw: bytes, min_len: int = 3):
    n = min(len(tag_ids), len(raw))
    # Class per byte, prefixes discarded.
    cls_of = [None] * n
    for i in range(n):
        name = tags[tag_ids[i]]
        cls_of[i] = None if name == "O" else name.split("-", 1)[1]

    # Contiguous runs.
    spans, i = [], 0
    while i < n:
        c = cls_of[i]
        if c is None:
            i += 1
            continue
        j = i
        while j < n and cls_of[j] == c:
            j += 1
        spans.append({"cls": c, "s": i, "e": j})
        i = j

    # Snap edges out to whole words.
    for s in spans:
        while s["s"] > 0 and WORD.match(raw[s["s"] - 1 : s["s"]]):
            s["s"] -= 1
        while s["e"] < len(raw) and WORD.match(raw[s["e"] : s["e"] + 1]):
            s["e"] += 1

    # Merge anything now touching or separated by a single separator. Classes
    # may differ - adjacent NAME and ADDR runs are one entity in practice, and
    # the wider mask is the safer error.
    spans.sort(key=lambda s: (s["s"], -s["e"]))
    merged = []
    for s in spans:
        if merged and s["s"] <= merged[-1]["e"]:
            merged[-1]["e"] = max(merged[-1]["e"], s["e"])
            continue
        if merged and GAP.match(raw[merged[-1]["e"] : s["s"]] or b"\x00"):
            merged[-1]["e"] = max(merged[-1]["e"], s["e"])
            continue
        merged.append(dict(s))

    return [s for s in merged if s["e"] - s["s"] >= min_len]
