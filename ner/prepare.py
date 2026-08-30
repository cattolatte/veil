"""
Build character-level BIO training data from ai4privacy.

Only the categories regex fundamentally CANNOT do are modelled. Aadhaar, PAN,
card and IFSC already score 95-100% precision from checksums; asking a neural
model to relearn them would trade certainty for probability. The model's job is
names, addresses, usernames and IPs — the 63.5% of instances the regex layer
does not even attempt.

Character level is deliberate:
  - no tokenizer to ship or keep in sync with the browser
  - handles any script, including Devanagari, without a vocabulary
  - degrades gracefully on the mangled text real pages contain
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

# ai4privacy label -> our coarse class. Everything unmapped becomes O.
LABEL_MAP = {
    "GIVENNAME1": "NAME", "GIVENNAME2": "NAME", "LASTNAME1": "NAME",
    "LASTNAME2": "NAME", "LASTNAME3": "NAME", "TITLE": "NAME",
    "CITY": "ADDR", "STATE": "ADDR", "STREET": "ADDR", "BUILDING": "ADDR",
    "SECADDRESS": "ADDR", "POSTCODE": "ADDR", "COUNTRY": "ADDR",
    "USERNAME": "USER",
    "IP": "IP",
}
CLASSES = ["NAME", "ADDR", "USER", "IP"]
TAGS = ["O"] + [f"{p}-{c}" for c in CLASSES for p in ("B", "I")]
TAG2ID = {t: i for i, t in enumerate(TAGS)}

MAXLEN = 384
STRIDE = 320
VOCAB_SIZE = 256          # raw bytes; unseen scripts fold into byte sequences


def encode_chars(text: str) -> np.ndarray:
    return np.frombuffer(text.encode("utf-8", "replace")[:1_000_000], dtype=np.uint8)


def char_labels(text: str, spans: list[dict]) -> np.ndarray:
    """BIO tags per UTF-8 byte, so labels stay aligned with the byte encoding."""
    b = text.encode("utf-8", "replace")
    tags = np.zeros(len(b), dtype=np.int64)
    for s in spans:
        cls = LABEL_MAP.get(s["label"])
        if not cls:
            continue
        # char offsets -> byte offsets
        start = len(text[: s["start"]].encode("utf-8", "replace"))
        end = len(text[: s["end"]].encode("utf-8", "replace"))
        if start >= len(b):
            continue
        tags[start] = TAG2ID[f"B-{cls}"]
        if end > start + 1:
            tags[start + 1 : end] = TAG2ID[f"I-{cls}"]
    return tags


def windows(x: np.ndarray, y: np.ndarray):
    if len(x) <= MAXLEN:
        yield x, y
        return
    for i in range(0, len(x) - 1, STRIDE):
        chunk_x, chunk_y = x[i : i + MAXLEN], y[i : i + MAXLEN]
        if len(chunk_x) < 32:
            break
        yield chunk_x, chunk_y


def main() -> None:
    src = Path("datagen/external/pii300k-validation.parquet")
    df = pd.read_parquet(src)
    print(f"source rows: {len(df)}  languages: {df.language.nunique()}")

    X, Y = [], []
    kept_spans = 0
    for _, r in df.iterrows():
        spans = [{"start": int(m["start"]), "end": int(m["end"]), "label": m["label"]}
                 for m in r.privacy_mask]
        kept_spans += sum(1 for s in spans if s["label"] in LABEL_MAP)
        x = encode_chars(r.source_text)
        y = char_labels(r.source_text, spans)
        n = min(len(x), len(y))
        for wx, wy in windows(x[:n], y[:n]):
            X.append(wx)
            Y.append(wy)

    out = Path("ner/data")
    out.mkdir(parents=True, exist_ok=True)
    # Pad to a rectangular array; 0 is both PAD and the O tag, and a mask
    # keeps padding out of the loss.
    Xp = np.zeros((len(X), MAXLEN), dtype=np.uint8)
    Yp = np.zeros((len(X), MAXLEN), dtype=np.int64)
    M = np.zeros((len(X), MAXLEN), dtype=np.uint8)
    for i, (x, y) in enumerate(zip(X, Y)):
        L = len(x)
        Xp[i, :L] = x
        Yp[i, :L] = y
        M[i, :L] = 1
    np.savez_compressed(out / "train.npz", x=Xp, y=Yp, mask=M)
    (out / "tags.json").write_text(json.dumps({"tags": TAGS, "maxlen": MAXLEN}))

    dist = {TAGS[i]: int((Yp * M).__eq__(i).sum()) for i in range(len(TAGS))}
    print(f"windows: {len(X)}  in-scope spans: {kept_spans}")
    print("tag distribution:", {k: v for k, v in dist.items() if v})


if __name__ == "__main__":
    main()
