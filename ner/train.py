"""Train the character-level PII tagger."""
from __future__ import annotations

import json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))   # run from the repo root

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from model import CharPIITagger, param_count

DATA = Path("ner/data")
d = np.load(DATA / "train.npz")
meta = json.loads((DATA / "tags.json").read_text())
TAGS = meta["tags"]

X = torch.from_numpy(d["x"].astype(np.int64))
Y = torch.from_numpy(d["y"])
M = torch.from_numpy(d["mask"].astype(np.float32))

n = len(X); idx = torch.randperm(n, generator=torch.Generator().manual_seed(0))
cut = int(n * 0.92)
tr, va = idx[:cut], idx[cut:]
print(f"windows: train {len(tr)}  val {len(va)}  tags {len(TAGS)}")

dev = "mps" if torch.backends.mps.is_available() else "cpu"
model = CharPIITagger(len(TAGS)).to(dev)
print(f"parameters: {param_count(model):,}  (~{param_count(model)*4/1024:.0f} KB fp32)")

# O outnumbers PII bytes ~19:1. Without weighting the model learns to predict O
# everywhere and reports a deceptively low loss.
counts = torch.bincount(Y[(M > 0)].flatten(), minlength=len(TAGS)).float()
w = (counts.sum() / (counts + 1)).pow(0.5)
w = (w / w.mean()).to(dev)
print("class weights:", {TAGS[i]: round(float(w[i]), 2) for i in range(len(TAGS))})

lossf = nn.CrossEntropyLoss(weight=w, reduction="none")
opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
EPOCHS = 4
dl = DataLoader(TensorDataset(X[tr], Y[tr], M[tr]), batch_size=64, shuffle=True)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=EPOCHS * len(dl))

def evaluate():
    model.eval()
    tp = torch.zeros(len(TAGS)); fp = torch.zeros(len(TAGS)); fn = torch.zeros(len(TAGS))
    with torch.no_grad():
        for i in range(0, len(va), 256):
            b = va[i:i+256]
            xb, yb, mb = X[b].to(dev), Y[b].to(dev), M[b].to(dev)
            pred = model(xb).argmax(-1)
            sel = mb > 0
            p, y = pred[sel].cpu(), yb[sel].cpu()
            for t in range(len(TAGS)):
                tp[t] += ((p == t) & (y == t)).sum()
                fp[t] += ((p == t) & (y != t)).sum()
                fn[t] += ((p != t) & (y == t)).sum()
    model.train()
    # Entity-level classes only; O dominates and would mask everything.
    ptp, pfp, pfn = tp[1:].sum(), fp[1:].sum(), fn[1:].sum()
    P = ptp / (ptp + pfp + 1e-9); R = ptp / (ptp + pfn + 1e-9)
    return P.item(), R.item(), (2*P*R/(P+R+1e-9)).item(), tp, fp, fn

t0 = time.time()
for ep in range(EPOCHS):
    tot = 0.0
    for step, (xb, yb, mb) in enumerate(dl):
        xb, yb, mb = xb.to(dev), yb.to(dev), mb.to(dev)
        out = model(xb)
        l = (lossf(out.reshape(-1, len(TAGS)), yb.reshape(-1)) * mb.reshape(-1)).sum() / mb.sum()
        opt.zero_grad(); l.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step(); sched.step()
        tot += l.item()
        if step % 300 == 0:
            print(f"  ep{ep} step {step}/{len(dl)} loss {l.item():.4f}")
    P, R, F, tp, fp, fn = evaluate()
    print(f"epoch {ep}: loss {tot/len(dl):.4f}  byte-level P {P:.1%} R {R:.1%} F1 {F:.1%}  ({time.time()-t0:.0f}s)")

print("\nper-class (byte level):")
for t in range(1, len(TAGS)):
    p = tp[t]/(tp[t]+fp[t]+1e-9); r = tp[t]/(tp[t]+fn[t]+1e-9)
    print(f"  {TAGS[t]:<8} P {p:.1%}  R {r:.1%}")

Path("ner/out").mkdir(exist_ok=True)
torch.save(model.state_dict(), "ner/out/tagger.pt")
print("\nsaved ner/out/tagger.pt")
