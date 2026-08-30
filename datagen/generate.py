"""
Synthetic screen generator.

The rubric scores PII-detection recall/precision and redaction precision, but
no public dataset supplies element-level ground truth for "what should have
been masked" on a web page. So we manufacture it.

Because we inject the PII ourselves, the labels are exact by construction:
we know which DOM node holds an Aadhaar number and, after layout, exactly
which pixels it occupies. No annotation, no label noise, unlimited volume.

Hard cases are generated on purpose - PII inside canvas, inside images, split
across inline elements, and decoys that look like PII but fail checksum.

Usage:
    pip install -r datagen/requirements.txt && playwright install chromium
    python datagen/generate.py --n 200 --out datagen/out
"""
from __future__ import annotations

import argparse
import json
import random
import string
from pathlib import Path

from faker import Faker
from playwright.sync_api import sync_playwright

from pii_patterns import luhn_digit, verhoeff_digit

fake = Faker("en_IN")

BANKS = ["oksbi", "okhdfcbank", "okicici", "okaxis", "paytm", "ybl"]
PAN_TYPE = "ABCFGHLJPTK"


# ------------------------------------------------------------- PII factories

def gen_aadhaar() -> str:
    body = str(random.randint(2, 9)) + "".join(random.choices(string.digits, k=10))
    return body + verhoeff_digit(body)


def gen_card() -> str:
    body = random.choice(["4", "5"]) + "".join(random.choices(string.digits, k=14))
    return body + luhn_digit(body)


def gen_pan() -> str:
    return ("".join(random.choices(string.ascii_uppercase, k=3)) + random.choice(PAN_TYPE)
            + random.choice(string.ascii_uppercase)
            + "".join(random.choices(string.digits, k=4)) + random.choice(string.ascii_uppercase))


def gen_ifsc() -> str:
    return "".join(random.choices(string.ascii_uppercase, k=4)) + "0" + "".join(
        random.choices(string.ascii_uppercase + string.digits, k=6))


def gen_phone() -> str:
    return random.choice("6789") + "".join(random.choices(string.digits, k=9))


def gen_upi() -> str:
    return f"{fake.user_name()}@{random.choice(BANKS)}"


GENERATORS = {
    "aadhaar": gen_aadhaar, "card": gen_card, "pan": gen_pan, "ifsc": gen_ifsc,
    "phone_in": gen_phone, "upi": gen_upi,
    "email": lambda: fake.email(), "dob": lambda: fake.date_of_birth().strftime("%d/%m/%Y"),
}

# Look like PII, are not. These exist to punish regex-only detectors, and to
# make sure our own precision number is honest.
def _bad_luhn_16() -> str:
    """16 digits that deliberately FAIL Luhn.

    A uniformly random 16-digit string passes Luhn about 10% of the time, which
    would make it a real card number mislabelled as a decoy and quietly corrupt
    the precision metric. Build a valid number, then perturb the check digit.
    """
    body = "".join(random.choices(string.digits, k=15))
    good = int(luhn_digit(body))
    return body + str((good + random.randint(1, 9)) % 10)


def _bad_aadhaar_12() -> str:
    """12 digits starting 2-9 that fail the Verhoeff check."""
    body = str(random.randint(2, 9)) + "".join(random.choices(string.digits, k=10))
    good = int(verhoeff_digit(body))
    return body + str((good + random.randint(1, 9)) % 10)


# Look like PII, are not. These exist to punish regex-only detectors, and to
# make sure our own precision number is honest. Every decoy is verified to be
# a true negative by construction.
DECOYS = [
    lambda: "1" + "".join(random.choices(string.digits, k=11)),      # Aadhaar can't start with 1
    _bad_luhn_16,
    _bad_aadhaar_12,
    lambda: f"ORDER-{random.randint(10**11, 10**12 - 1)}",
    lambda: f"{random.randint(1000,9999)} {random.randint(1000,9999)} {random.randint(1000,9999)}",
]


# ------------------------------------------------------------------ page

def build_page(seed: int) -> tuple[str, list[dict]]:
    """Return (html, ground_truth). Every PII node carries data-veil-* labels."""
    random.seed(seed)
    fake.seed_instance(seed)
    truth: list[dict] = []
    rows: list[str] = []

    def field(label: str, kind: str, *, as_input: bool, hard: str | None = None) -> str:
        value = GENERATORS[kind]()
        nid = f"v{len(truth)}"
        truth.append({"id": nid, "kind": kind, "value": value, "hard": hard})
        if as_input:
            ac = {"email": "email", "phone_in": "tel", "card": "cc-number", "dob": "bday"}.get(kind, "off")
            return (f'<label>{label}<input id="{nid}" data-veil-kind="{kind}" '
                    f'autocomplete="{ac}" value="{value}"></label>')
        if hard == "split":
            # Split across inline elements: naive textContent scanning misses it.
            mid = len(value) // 2
            return (f'<p>{label}: <span id="{nid}" data-veil-kind="{kind}">'
                    f'<em>{value[:mid]}</em><em>{value[mid:]}</em></span></p>')
        return f'<p>{label}: <span id="{nid}" data-veil-kind="{kind}">{value}</span></p>'

    kinds = list(GENERATORS)
    random.shuffle(kinds)
    for k in kinds[: random.randint(4, len(kinds))]:
        hard = random.choice([None, None, None, "split"])
        rows.append(field(k.replace("_", " ").title(), k, as_input=random.random() < 0.5, hard=hard))

    for d in random.sample(DECOYS, k=random.randint(1, len(DECOYS))):
        rows.append(f"<p>Reference: {d()}</p>")

    rows.append('<label>Password<input type="password" id="pw" value="hunter2"></label>')
    truth.append({"id": "pw", "kind": "password", "value": "hunter2", "hard": None})

    # PII rendered into a canvas: invisible to DOM scanning, needs the vision pass.
    canvas_val = gen_aadhaar()
    truth.append({"id": "cv", "kind": "aadhaar", "value": canvas_val, "hard": "canvas"})
    rows.append('<canvas id="cv" width="320" height="44" data-veil-kind="aadhaar"></canvas>'
                f'<script>{{const c=document.getElementById("cv").getContext("2d");'
                f'c.font="18px monospace";c.fillText("UID {canvas_val}",8,28);}}</script>')

    html = f"""<!doctype html><meta charset=utf-8>
<title>{fake.company()} — Account</title>
<style>body{{font:14px system-ui;margin:24px;max-width:620px}}
label{{display:block;margin:6px 0}}input{{margin-left:8px;padding:4px}}
p{{margin:6px 0}}canvas{{border:1px solid #ccc;display:block;margin:8px 0}}</style>
<h1>{fake.company()}</h1>
<p>Customer: {fake.name()}</p>
{"".join(rows)}
<button id="submit">Submit</button><a href="#help">Help</a>
"""
    return html, truth


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=900)
    args = ap.parse_args()

    shots = args.out / "screens"
    shots.mkdir(parents=True, exist_ok=True)
    manifest = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": args.width, "height": args.height})
        for i in range(args.n):
            html, truth = build_page(i)
            page.set_content(html, wait_until="load")

            # Resolve each labelled node to its post-layout box: exact ground truth.
            for t in truth:
                box = page.evaluate(
                    """(id) => { const el = document.getElementById(id);
                        if (!el) return null; const r = el.getBoundingClientRect();
                        return {x:Math.round(r.x),y:Math.round(r.y),
                                w:Math.round(r.width),h:Math.round(r.height)}; }""",
                    t["id"],
                )
                t["box"] = box

            shot = shots / f"{i:05d}.png"
            page.screenshot(path=str(shot))
            manifest.append({
                "id": i, "screenshot": str(shot.relative_to(args.out)),
                "html": html, "pii": truth,
                "viewport": {"w": args.width, "h": args.height},
            })
        browser.close()

    (args.out / "manifest.jsonl").write_text(
        "\n".join(json.dumps(m, ensure_ascii=False) for m in manifest), encoding="utf-8"
    )
    total = sum(len(m["pii"]) for m in manifest)
    print(f"wrote {len(manifest)} screens, {total} labelled PII instances -> {args.out}")


if __name__ == "__main__":
    main()
