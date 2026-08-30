"""
Real-page harvester.

The generator produces exact labels but unrealistic pages: tidy little forms
nothing like the web. Public corpora have the opposite problem - real pages,
but no labels for what should be redacted, because nobody has ever annotated
that.

This closes the gap. Load a real page, inject known PII into its real DOM,
screenshot it. Layout, nesting, styling and clutter are genuinely real; the
labels are exact because we placed the values ourselves.

Injection deliberately mirrors how PII appears in the wild:
  - into existing text nodes, inheriting the page's own styling
  - split across inline elements, which defeats naive text-node scanning
  - into real form fields, so structural detection is exercised
  - drawn into a canvas, reachable only by the vision pass

Usage:
    python datagen/harvest.py --out datagen/harvest_out --per-page 6
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from generate import GENERATORS  # noqa: E402  same PII factories, one source of truth

# Public, static, robots-friendly pages with varied real-world layout.
DEFAULT_URLS = [
    "https://en.wikipedia.org/wiki/Privacy",
    "https://en.wikipedia.org/wiki/Web_browser",
    "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form",
    "https://www.w3.org/WAI/tutorials/forms/",
    "https://example.com/",
    "https://httpbin.org/forms/post",
]

# Injection strategies. `hard` mirrors the generator's vocabulary so both
# corpora score through the same harness.
STRATEGIES = ["text", "split", "field", "canvas"]

INJECT_JS = """
([kind, value, strategy, idx]) => {
  const id = `veil-inj-${idx}`;

  // Candidate text nodes: long enough to look natural, in a visible block.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hosts = [];
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (!p || ['SCRIPT','STYLE','NOSCRIPT'].includes(p.tagName)) continue;
    if ((n.nodeValue || '').trim().length < 40) continue;
    const r = p.getBoundingClientRect();
    if (r.width < 80 || r.height < 10) continue;
    hosts.push(p);
  }
  if (!hosts.length) return null;
  const host = hosts[idx % hosts.length];

  const mk = (html) => {
    const span = document.createElement('span');
    span.id = id;
    span.innerHTML = html;
    return span;
  };

  let el;
  if (strategy === 'split') {
    const mid = Math.floor(value.length / 2);
    el = mk(`<em>${value.slice(0, mid)}</em><em>${value.slice(mid)}</em>`);
    host.appendChild(document.createTextNode(' '));
    host.appendChild(el);
  } else if (strategy === 'field') {
    const input = document.createElement('input');
    input.id = id; input.value = value; input.size = 24;
    // Mirror into the attribute so the value survives page.content(); the
    // live extension reads el.value, but the offline harness sees only HTML.
    input.setAttribute('value', value);
    input.setAttribute('autocomplete', kind === 'email' ? 'email' : 'off');
    host.appendChild(document.createTextNode(' '));
    host.appendChild(input);
    el = input;
  } else if (strategy === 'canvas') {
    const c = document.createElement('canvas');
    c.id = id; c.width = 300; c.height = 40;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 40);
    g.fillStyle = '#000'; g.font = '16px monospace';
    g.fillText(value, 6, 26);
    host.appendChild(c);
    el = c;
  } else {
    // Dates on real pages are labelled ("Born: 15 March 1987"); a bare date in
    // prose is not personal data. Planting one unlabelled would be testing a
    // case the detector is deliberately built to ignore.
    const prefix = kind === 'dob' ? 'Date of Birth: ' : '';
    el = mk(prefix + value);
    host.appendChild(document.createTextNode(' '));
    host.appendChild(el);
  }

  const r = el.getBoundingClientRect();
  return { id, box: { x: Math.round(r.x), y: Math.round(r.y),
                      w: Math.round(r.width), h: Math.round(r.height) } };
}
"""


def harvest(urls, out: Path, per_page: int, width: int, height: int, seed: int,
            no_html: bool = False) -> None:
    random.seed(seed)
    shots = out / "screens"
    shots.mkdir(parents=True, exist_ok=True)
    manifest = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": width, "height": height})
        for i, url in enumerate(urls):
            page = ctx.new_page()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                page.wait_for_timeout(700)
            except Exception as e:
                print(f"  skip {url}: {str(e)[:70]}")
                page.close()
                continue

            # Real pages carry real PII of their own — python.org and gnu.org
            # publish genuine contact addresses. Detecting those is CORRECT, but
            # the scorer would count them as false positives because we did not
            # plant them. Capture the page first so they can be subtracted.
            baseline_html = "" if no_html else page.content()

            planted = []
            kinds = random.sample(list(GENERATORS), k=min(per_page, len(GENERATORS)))
            for j, kind in enumerate(kinds):
                value = GENERATORS[kind]()
                strategy = STRATEGIES[j % len(STRATEGIES)]
                try:
                    res = page.evaluate(INJECT_JS, [kind, value, strategy, j])
                except Exception:
                    res = None
                if not res:
                    continue
                planted.append({
                    "id": res["id"], "kind": kind, "value": value,
                    "hard": None if strategy == "text" else strategy,
                    "box": res["box"],
                })

            if not planted:
                print(f"  no injection point: {url}")
                page.close()
                continue

            html = "" if no_html else page.content()
            shot = shots / f"{i:04d}.png"
            page.screenshot(path=str(shot), full_page=False)
            manifest.append({
                "id": i, "url": url, "screenshot": str(shot.relative_to(out)),
                "html": html,
                "baseline_html": "" if no_html else baseline_html,
                "pii": planted,
                "viewport": {"w": width, "h": height},
            })
            if i % 25 == 0 or i == len(urls) - 1:
                print(f"  [{i+1}/{len(urls)}] {url[:52]:<52} {len(planted)} planted", flush=True)
            page.close()
        browser.close()

    (out / "manifest.jsonl").write_text(
        "\n".join(json.dumps(m, ensure_ascii=False) for m in manifest), encoding="utf-8"
    )
    total = sum(len(m["pii"]) for m in manifest)
    print(f"\nharvested {len(manifest)} real pages, {total} planted PII instances -> {out}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "harvest_out")
    ap.add_argument("--urls", type=Path, help="file with one URL per line")
    ap.add_argument("--per-page", type=int, default=6)
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument(
        "--no-html", action="store_true",
        help="Omit page HTML from the manifest. The text scorer needs it; the "
             "vision trainer only needs screenshots and boxes, and storing it "
             "costs ~1.8 MB per page (642 MB across 356).",
    )
    a = ap.parse_args()
    urls = a.urls.read_text().split() if a.urls else DEFAULT_URLS
    harvest(urls, a.out, a.per_page, a.width, a.height, a.seed, a.no_html)


if __name__ == "__main__":
    main()
