"""
Character-level PII tagger.

Dilated CNN rather than a BiLSTM, for one deployment reason: convolutions are
well supported by ONNX Runtime's WebGPU backend and run in parallel across the
sequence, while an LSTM steps serially and often falls back to WASM. Latency is
15% of the score, so the architecture is chosen for how it runs in a browser,
not only for how it trains.

Dilations 1,2,4,8,16 give a receptive field of ~63 bytes either side — enough
to see "Date of Birth:" before a value, or a title before a surname, which is
exactly the context the regex layer had to be told about by hand.
"""
from __future__ import annotations

import torch
import torch.nn as nn


class CharPIITagger(nn.Module):
    def __init__(self, n_tags: int, vocab: int = 256, dim: int = 64, dilations=(1, 2, 4, 8, 16)):
        super().__init__()
        self.emb = nn.Embedding(vocab, dim)
        self.blocks = nn.ModuleList([
            nn.Sequential(
                nn.Conv1d(dim, dim, kernel_size=3, padding=d, dilation=d),
                nn.GELU(),
                nn.Conv1d(dim, dim, kernel_size=1),
            )
            for d in dilations
        ])
        self.norms = nn.ModuleList([nn.GroupNorm(1, dim) for _ in dilations])
        self.head = nn.Conv1d(dim, n_tags, kernel_size=1)

    def forward(self, x):                      # x: (B, L) uint8 -> (B, L, T)
        h = self.emb(x).transpose(1, 2)        # (B, D, L)
        for blk, nrm in zip(self.blocks, self.norms):
            h = nrm(h + blk(h))                # residual keeps gradients healthy at depth
        return self.head(h).transpose(1, 2)    # (B, L, T)


def param_count(m: nn.Module) -> int:
    return sum(p.numel() for p in m.parameters())
