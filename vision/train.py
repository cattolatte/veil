"""Train the screen perception net."""
from __future__ import annotations

import json, sys, time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

sys.path.insert(0, str(Path(__file__).parent))
from model import ScreenPerception, param_count

# Validation is a held-out set of REAL pages, split by page in prepare.py.
# A synthetic validation split cannot answer the only question that matters,
# and answered it wrongly once already: 99.8% on template, 12.5% on real.
d = np.load("vision/data/train.npz")
t = np.load("vision/data/test_real.npz")
X = torch.from_numpy(d["x"]); Y = torch.from_numpy(d["y"]).unsqueeze(1)
Xv = torch.from_numpy(t["x"]); Yv = torch.from_numpy(t["y"]).unsqueeze(1)

tr = torch.arange(len(X))
dev = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"screens: train {len(X)}  held-out REAL val {len(Xv)}  device {dev}")

model = ScreenPerception().to(dev)
print(f"parameters: {param_count(model):,}  (~{param_count(model)*4/1024:.0f} KB fp32)")

# Positives are ~6% of cells, so unweighted BCE learns to answer "no" everywhere.
pos = float(Y.mean())
pos_weight = torch.tensor([(1 - pos) / pos], device=dev)
lossf = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
print(f"positive rate {pos:.2%}  pos_weight {pos_weight.item():.1f}")

EPOCHS = 16
dl = DataLoader(TensorDataset(X[tr], Y[tr]), batch_size=16, shuffle=True)
opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.01)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=EPOCHS * len(dl))


def evaluate(thr=0.5):
    model.eval(); tp = fp = fn = 0; flagged = 0.0; cells = 0
    with torch.no_grad():
        for i in range(0, len(Xv), 32):
            xb = Xv[i:i+32].to(dev).float() / 255.0
            yb = Yv[i:i+32].to(dev)
            p = (torch.sigmoid(model(xb)) > thr).float()
            tp += float((p * yb).sum()); fp += float((p * (1 - yb)).sum()); fn += float(((1 - p) * yb).sum())
            flagged += float(p.sum()); cells += p.numel()
    model.train()
    P = tp / (tp + fp + 1e-9); R = tp / (tp + fn + 1e-9)
    return P, R, 2 * P * R / (P + R + 1e-9), flagged / cells


t0 = time.time()
for ep in range(EPOCHS):
    tot = 0.0
    for xb, yb in dl:
        xb = xb.to(dev).float() / 255.0
        yb = yb.to(dev)
        loss = lossf(model(xb), yb)
        opt.zero_grad(); loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step(); sched.step()
        tot += loss.item()
    if ep % 2 == 1 or ep == EPOCHS - 1:
        P, R, F, frac = evaluate()
        print(f"epoch {ep:2d}  loss {tot/len(dl):.4f}  REAL P {P:.1%} R {R:.1%} F1 {F:.1%}  screen {frac:.1%}  ({time.time()-t0:.0f}s)")

Path("vision/out").mkdir(exist_ok=True)
torch.save(model.state_dict(), "vision/out/screen.pt")
print("\nthreshold sweep on HELD-OUT REAL pages:")
for th in (0.5, 0.7, 0.9, 0.95, 0.99):
    P, R, F, frac = evaluate(th)
    print(f"  thr {th:<5} P {P:>6.1%}  R {R:>6.1%}  F1 {F:>6.1%}  screen flagged {frac:>6.1%}")
print("\nsaved vision/out/screen.pt")
