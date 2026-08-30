"""
Scores detector predictions against generated ground truth.

Maps onto the published rubric. This harness covers the two components that
can be measured without a browser:

    20%  recall & precision of sensitive/PII detection
    20%  precision of redaction  (proxied by false-positive rate: every false
                                  positive is text that was masked and should
                                  not have been)

The remaining 55% - visual context accuracy, client resource utilisation,
end-to-end latency - needs the extension running in a real browser and is
measured separately.

    python eval/score.py datagen/out/manifest.jsonl eval/out/predictions.jsonl
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

# Detected structurally (element type / autocomplete), never from text. Excluded
# from the textual scores so they neither inflate nor deflate them.
STRUCTURAL_ONLY = {"password"}


def load(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").strip().split("\n")]


def norm(v: str) -> str:
    """Compare PII values ignoring separators, so '2341 2341 2346' == '234123412346'."""
    return "".join(ch for ch in (v or "") if ch.isalnum()).upper()


def prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", type=Path)
    ap.add_argument("predictions", type=Path)
    ap.add_argument("--mode", choices=["joined", "perNode", "block", "all"], default="all")
    args = ap.parse_args()

    truth_by_id = {m["id"]: m for m in load(args.manifest)}
    preds = load(args.predictions)
    modes = ["perNode", "block", "joined"] if args.mode == "all" else [args.mode]

    for mode in modes:
        tp_k: Counter[str] = Counter()
        fp_k: Counter[str] = Counter()
        fn_k: Counter[str] = Counter()
        hard_total: Counter[str] = Counter()
        hard_found: Counter[str] = Counter()
        stats_preexisting: Counter[str] = Counter()

        for p in preds:
            truth = truth_by_id[p["id"]]
            gold = [t for t in truth["pii"] if t["kind"] not in STRUCTURAL_ONLY]
            got = [g for g in p[mode] if g["kind"] not in STRUCTURAL_ONLY]

            # Match predictions to planted instances by (kind, normalised value).
            # Counting alone would credit a canvas miss whenever any other
            # instance of the same kind happened to be found on that page.
            pool: dict[tuple[str, str], int] = defaultdict(int)
            for g in got:
                pool[(g["kind"], norm(g["text"]))] += 1

            # Subtract PII that was already on the page before injection.
            # Finding a real contact address on python.org is a correct
            # detection; counting it as a false positive measures the harness,
            # not the detector.
            for b in p.get("baseline", []):
                key = (b["kind"], norm(b["text"]))
                if pool.get(key, 0) > 0:
                    pool[key] -= 1
                    stats_preexisting[b["kind"]] += 1

            for t in gold:
                key = (t["kind"], norm(t["value"]))
                if pool.get(key, 0) > 0:
                    pool[key] -= 1
                    tp_k[t["kind"]] += 1
                    if t["hard"]:
                        hard_total[t["hard"]] += 1
                        hard_found[t["hard"]] += 1
                else:
                    fn_k[t["kind"]] += 1
                    if t["hard"]:
                        hard_total[t["hard"]] += 1

            for (kind, _), n in pool.items():
                if n > 0:
                    fp_k[kind] += n

        TP, FP, FN = sum(tp_k.values()), sum(fp_k.values()), sum(fn_k.values())
        P, R, F = prf(TP, FP, FN)

        print(f"\n{'=' * 66}\nmode: {mode}\n{'=' * 66}")
        print(f"  precision {P:6.1%}   recall {R:6.1%}   F1 {F:6.1%}")
        print(f"  tp {TP}   fp {FP}   fn {FN}")

        print(f"\n  {'kind':<12}{'tp':>5}{'fp':>5}{'fn':>5}{'prec':>9}{'recall':>9}")
        print(f"  {'-' * 45}")
        for kind in sorted(set(tp_k) | set(fp_k) | set(fn_k)):
            p_, r_, _ = prf(tp_k[kind], fp_k[kind], fn_k[kind])
            print(f"  {kind:<12}{tp_k[kind]:>5}{fp_k[kind]:>5}{fn_k[kind]:>5}{p_:>9.1%}{r_:>9.1%}")

        if hard_total:
            print(f"\n  hard-case recall")
            print(f"  {'-' * 45}")
            for h in sorted(hard_total):
                rec = hard_found[h] / hard_total[h] if hard_total[h] else 0.0
                note = {
                    "split": "PII split across inline elements",
                    "canvas": "PII drawn into <canvas> - needs the vision pass",
                }.get(h, "")
                print(f"  {h:<12}{hard_found[h]:>3}/{hard_total[h]:<4}{rec:>8.1%}   {note}")

        if stats_preexisting:
            total_pre = sum(stats_preexisting.values())
            kinds_pre = ", ".join(f"{k}:{v}" for k, v in stats_preexisting.most_common(6))
            print(f"\n  pre-existing PII found on pages (excluded from FP): {total_pre}")
            print(f"  {kinds_pre}")

        print(f"\n  rubric contribution")
        print(f"  {'-' * 45}")
        print(f"  detection (20%)  F1 {F:.1%}")
        print(f"  redaction (20%)  precision {P:.1%}  ({FP} spans masked in error)")


if __name__ == "__main__":
    main()
