"""
Score the screen model on REAL harvested pages.

The generator's own held-out split cannot answer the only question that
matters. A first version scored 99.8% F1 on the template and 12.5% on real
pages while flagging half the screen: it had learned where PII sits on that
template, not what it looks like.
"""
from __future__ import annotations

import json, sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from model import ScreenPerception

meta = json.loads(Path("vision/data/meta.json").read_text())
IN_W, IN_H, CELL = meta["in_w"], meta["in_h"], meta["cell"]
GW, GH = meta["grid_w"], meta["grid_h"]


def main(root=Path("datagen/harvest_shots"), thresholds=(0.5, 0.7, 0.9, 0.95)):
    m = ScreenPerception()
    m.load_state_dict(torch.load("vision/out/screen.pt", map_location="cpu"))
    m.eval()

    rows = [json.loads(l) for l in (root / "manifest.jsonl").read_text().strip().split("\n")]
    probs, gts = [], []
    for r in rows:
        if not r.get("screenshot"):
            continue
        img = Image.open(root / r["screenshot"]).convert("RGB")
        sw, sh = img.size
        arr = np.array(img.resize((IN_W, IN_H), Image.BILINEAR)).transpose(2, 0, 1).copy()
        with torch.no_grad():
            p = torch.sigmoid(m(torch.from_numpy(arr).float()[None] / 255.0))[0, 0].numpy()
        gt = np.zeros((GH, GW), bool)
        fx, fy = IN_W / sw, IN_H / sh
        for pii in r["pii"]:
            b = pii.get("box")
            if not b or b["w"] <= 0:
                continue
            x0 = max(0, int(b["x"] * fx) // CELL); y0 = max(0, int(b["y"] * fy) // CELL)
            x1 = min(GW - 1, int((b["x"] + b["w"]) * fx) // CELL)
            y1 = min(GH - 1, int((b["y"] + b["h"]) * fy) // CELL)
            if x1 >= x0 and y1 >= y0:
                gt[y0:y1 + 1, x0:x1 + 1] = True
        probs.append(p); gts.append(gt)

    print(f"real pages scored: {len(probs)}\n")
    print(f"  {'thr':>5}{'precision':>12}{'recall':>10}{'F1':>9}{'screen flagged':>17}")
    print("  " + "-" * 52)
    for t in thresholds:
        tp = fp = fn = 0; frac = []
        for p, g in zip(probs, gts):
            pr = p > t
            tp += int((pr & g).sum()); fp += int((pr & ~g).sum()); fn += int((~pr & g).sum())
            frac.append(pr.mean())
        P = tp / (tp + fp + 1e-9); R = tp / (tp + fn + 1e-9)
        F = 2 * P * R / (P + R + 1e-9)
        print(f"  {t:>5}{P:>11.1%}{R:>10.1%}{F:>9.1%}{np.mean(frac):>16.1%}")


if __name__ == "__main__":
    main()
