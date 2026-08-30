"""
Screen perception net.

A small convolutional encoder that takes the rendered screen and predicts,
per 8x8 cell, whether that region holds content requiring redaction.

Convolutional rather than a patch-transformer for the same reason the text
tagger is: ONNX Runtime's WebGPU backend handles convolutions well and runs
them in parallel, while attention kernels are patchier and often fall back to
WASM. Client resource use is 20% of the score and latency 15%, so how it runs
in a browser decides the architecture.

Downsampling is done with strided convolutions to reach the 8x8 stride, then a
dilated block widens the receptive field so a cell can see its surroundings -
a value is recognisable partly by the label beside it.
"""
from __future__ import annotations

import torch
import torch.nn as nn


def block(cin, cout, stride=1, dilation=1):
    pad = dilation
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, stride=stride, padding=pad, dilation=dilation, bias=False),
        nn.BatchNorm2d(cout),
        nn.GELU(),
    )


class ScreenPerception(nn.Module):
    def __init__(self, width: int = 32):
        super().__init__()
        w = width
        self.stem = nn.Sequential(
            block(3, w, stride=2),        # 512x320 -> 256x160
            block(w, w),
        )
        self.down = nn.Sequential(
            block(w, w * 2, stride=2),    # -> 128x80
            block(w * 2, w * 2),
            block(w * 2, w * 4, stride=2),# -> 64x40  (stride 8 overall)
        )
        # Widen the receptive field without another downsample: a cell should
        # see the label sitting next to the value it belongs to.
        self.context = nn.Sequential(
            block(w * 4, w * 4, dilation=2),
            block(w * 4, w * 4, dilation=4),
        )
        self.head = nn.Conv2d(w * 4, 1, 1)

    def forward(self, x):
        # x: (B,3,H,W) float in 0..1 -> (B,1,H/8,W/8) logits
        h = self.stem(x)
        h = self.down(h)
        h = h + self.context(h)
        return self.head(h)


def param_count(m: nn.Module) -> int:
    return sum(p.numel() for p in m.parameters())
