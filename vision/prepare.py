"""
Build screen-perception training data from BOTH corpora.

A model trained only on the generator learns where PII sits on that template:
measured 99.8% F1 on its own held-out split and 12.5% on real pages, flagging
half the screen. Randomising the generator's layout helped (18.4% F1, 14% of
screen) but nowhere near enough. Real page structure is the missing signal.

Real pages are therefore split by PAGE before training, so evaluation is
against layouts the model has never seen. Synthetic pages supply volume and
guaranteed Indian identifiers; real pages supply structure and, crucially,
realistic negatives — the vast expanse of ordinary content that must NOT be
flagged.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

IN_W, IN_H = 512, 320
CELL = 8
GRID_W, GRID_H = IN_W // CELL, IN_H // CELL

SOURCES = [
    ("synthetic", Path("datagen/screens_out")),
    ("real", Path("datagen/harvest_big")),
]
REAL_TEST_FRACTION = 0.25


def encode(root: Path, rows: list[dict]):
    X = np.zeros((len(rows), 3, IN_H, IN_W), dtype=np.uint8)
    Y = np.zeros((len(rows), GRID_H, GRID_W), dtype=np.float32)
    for i, r in enumerate(rows):
        img = Image.open(root / r["screenshot"]).convert("RGB")
        sw, sh = img.size
        X[i] = np.asarray(img.resize((IN_W, IN_H), Image.BILINEAR)).transpose(2, 0, 1)
        fx, fy = IN_W / sw, IN_H / sh
        for p in r["pii"]:
            b = p.get("box")
            if not b or b["w"] <= 0 or b["h"] <= 0:
                continue
            x0 = max(0, int(b["x"] * fx) // CELL); y0 = max(0, int(b["y"] * fy) // CELL)
            x1 = min(GRID_W - 1, int((b["x"] + b["w"]) * fx) // CELL)
            y1 = min(GRID_H - 1, int((b["y"] + b["h"]) * fy) // CELL)
            if x1 >= x0 and y1 >= y0:
                Y[i, y0:y1 + 1, x0:x1 + 1] = 1.0
    return X, Y


def main() -> None:
    out = Path("vision/data"); out.mkdir(parents=True, exist_ok=True)
    bundles = {}
    for name, root in SOURCES:
        mf = root / "manifest.jsonl"
        if not mf.exists():
            print(f"  ! missing {mf}, skipping {name}")
            continue
        rows = [json.loads(l) for l in mf.read_text().strip().split("\n") if json.loads(l).get("screenshot")]
        bundles[name] = (root, rows)
        print(f"{name}: {len(rows)} screens")

    root_r, rows_r = bundles["real"]
    rng = np.random.default_rng(0)
    order = rng.permutation(len(rows_r))
    n_test = int(len(rows_r) * REAL_TEST_FRACTION)
    test_idx, train_idx = order[:n_test], order[n_test:]

    Xr, Yr = encode(root_r, rows_r)
    Xs, Ys = encode(*bundles["synthetic"])

    X_train = np.concatenate([Xs, Xr[train_idx]])
    Y_train = np.concatenate([Ys, Yr[train_idx]])
    np.savez_compressed(out / "train.npz", x=X_train, y=Y_train)
    np.savez_compressed(out / "test_real.npz", x=Xr[test_idx], y=Yr[test_idx])
    (out / "meta.json").write_text(json.dumps(
        {"in_w": IN_W, "in_h": IN_H, "cell": CELL, "grid_w": GRID_W, "grid_h": GRID_H,
         "real_test_ids": [rows_r[i]["id"] for i in test_idx.tolist()]}))

    print(f"\ntrain: {len(X_train)} screens ({len(Xs)} synthetic + {len(train_idx)} real)")
    print(f"held-out REAL test: {len(test_idx)} screens — layouts never trained on")
    print(f"positive cells — train {Y_train.mean():.2%}  real-test {Yr[test_idx].mean():.2%}")


if __name__ == "__main__":
    main()
