"""Export the tagger to ONNX and sanity-check it end to end."""
from __future__ import annotations

import json, sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from model import CharPIITagger, param_count

meta = json.loads(Path("ner/data/tags.json").read_text())
TAGS = meta["tags"]

model = CharPIITagger(len(TAGS))
model.load_state_dict(torch.load("ner/out/tagger.pt", map_location="cpu"))
model.eval()
print(f"parameters: {param_count(model):,}")

out = Path("ner/out"); out.mkdir(exist_ok=True)
# int32 rather than int64: the browser must build a typed array per inference,
# and BigInt64Array construction is markedly slower than Int32Array. The values
# are byte indices, so 32 bits is ample.
class Int32Wrapper(torch.nn.Module):
    def __init__(self, inner): super().__init__(); self.inner = inner
    def forward(self, x): return self.inner(x.long())

wrapped = Int32Wrapper(model).eval()
dummy = torch.zeros(1, 384, dtype=torch.int32)
torch.onnx.export(
    wrapped, (dummy,), str(out / "pii_tagger.onnx"),
    input_names=["chars"], output_names=["logits"],
    dynamic_axes={"chars": {0: "batch", 1: "len"}, "logits": {0: "batch", 1: "len"}},
    opset_version=17,
)
# torch's exporter may write weights to a .onnx.data sidecar, leaving a
# deceptively small graph file. Collapse it back to one self-contained file so
# the reported size is the size that actually has to ship.
import onnx
m = onnx.load(str(out / "pii_tagger.onnx"))
onnx.save_model(m, str(out / "pii_tagger.onnx"), save_as_external_data=False)
sidecar = out / "pii_tagger.onnx.data"
if sidecar.exists():
    sidecar.unlink()

size = (out / "pii_tagger.onnx").stat().st_size
print(f"onnx: {size/1024:.0f} KB (self-contained)")

# Verify parity between torch and onnxruntime, then show it on real text.
import onnxruntime as ort
sess = ort.InferenceSession(str(out / "pii_tagger.onnx"), providers=["CPUExecutionProvider"])

def tag(text):
    b = np.frombuffer(text.encode("utf-8"), dtype=np.uint8).astype(np.int32)[None]
    logits = sess.run(None, {"chars": b})[0][0]
    ids = logits.argmax(-1)
    spans, cur = [], None
    raw = text.encode("utf-8")
    for i, t in enumerate(ids):
        name = TAGS[t]
        if name == "O":
            if cur: spans.append(cur); cur = None
            continue
        pre, cls = name.split("-")
        if pre == "B" or cur is None or cur["cls"] != cls:
            if cur: spans.append(cur)
            cur = {"cls": cls, "s": i, "e": i + 1}
        else:
            cur["e"] = i + 1
    if cur: spans.append(cur)
    return [(s["cls"], raw[s["s"]:s["e"]].decode("utf-8", "replace")) for s in spans]

with torch.no_grad():
    t_out = model(torch.from_numpy(np.frombuffer(b"hello", dtype=np.uint8).astype(np.int64)[None])).numpy()
o_out = sess.run(None, {"chars": np.frombuffer(b"hello", dtype=np.uint8).astype(np.int32)[None]})[0]
print(f"torch/onnx max abs diff: {np.abs(t_out - o_out).max():.2e}")

print("\nsample predictions:")
for t in [
    "Please contact Dr. Priya Sharma at 14 MG Road, Bengaluru 560001.",
    "The server at 192.168.44.201 was accessed by user rk_mehta_88 last night.",
    "Refund issued to Anil Kumar Verma, Flat 3B, Sector 12, Noida, Uttar Pradesh.",
]:
    print(f"  {t}")
    for cls, txt in tag(t):
        if len(txt.strip()) > 1:
            print(f"      {cls:<5} {txt!r}")
