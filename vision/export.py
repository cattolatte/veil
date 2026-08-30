"""Export the screen perception net to a self-contained ONNX file."""
from __future__ import annotations

import json, sys, time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

sys.path.insert(0, str(Path(__file__).parent))
from model import ScreenPerception, param_count

meta = json.loads(Path("vision/data/meta.json").read_text())
IN_W, IN_H = meta["in_w"], meta["in_h"]

m = ScreenPerception()
m.load_state_dict(torch.load("vision/out/screen.pt", map_location="cpu"))
m.eval()
print(f"parameters: {param_count(m):,}")

out = Path("vision/out"); out.mkdir(exist_ok=True)
path = out / "screen.onnx"
torch.onnx.export(m, (torch.zeros(1, 3, IN_H, IN_W),), str(path),
                  input_names=["screen"], output_names=["logits"], opset_version=17)

# Collapse any external-data sidecar so the reported size is the shipped size.
onnx.save_model(onnx.load(str(path)), str(path), save_as_external_data=False)
for extra in out.glob("screen.onnx.data"):
    extra.unlink()
print(f"onnx: {path.stat().st_size/1024:.0f} KB (self-contained)")

sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
x = np.random.rand(1, 3, IN_H, IN_W).astype(np.float32)
with torch.no_grad():
    t_out = m(torch.from_numpy(x)).numpy()
o_out = sess.run(None, {"screen": x})[0]
print(f"torch/onnx max abs diff: {np.abs(t_out - o_out).max():.2e}")

runs = []
for _ in range(12):
    t0 = time.perf_counter(); sess.run(None, {"screen": x}); runs.append((time.perf_counter()-t0)*1000)
runs.sort()
print(f"cpu inference median: {runs[len(runs)//2]:.0f} ms  (WebGPU will be faster)")
print(f"output grid: {o_out.shape}")
