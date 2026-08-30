# Veil

**Privacy-preserving on-device visual perception for browser agents.**

A local vision model reads the screen, sensitive content is detected and
redacted **before any network request**, and only anonymised structure reaches
the server — which returns an action the client executes.

> Smart India Hackathon 2026 · Problem Statement `SIH26171` · ISRO / Department of Space

---

## The problem

AI agents become useful when they can see your screen. But almost every agentic
pipeline runs server-side, so your screen — passwords, faces, identifiers —
must leave your machine before anything decides it was sensitive. Either you
don't use agents on anything that matters, or you accept the leak.

Veil splits the pipeline at the trust boundary. Perception runs locally;
only sanitised structure crosses the network.

```
┌─────────────────── CLIENT (trusted) ────────────────────┐
│  content.js — sees raw DOM, raw pixels, raw values      │
│    ├─ lib/pii.js        structural + checksum detection │
│    ├─ lib/redact.js     span redaction, canvas masking  │
│    ├─ vision/engine.js  YuNet on WebGPU, budgeted       │
│    └─ lib/serialize.js  builds sanitised context        │
└────────────────────────┬────────────────────────────────┘
                         │  structure only, never content
     ═══════════ TRUST BOUNDARY ═══════════
                         │
┌────────────────────────▼────────────────────────────────┐
│  server/main.py — validates, audits for leaks, decides  │
└────────────────────────┬────────────────────────────────┘
                         │  {type, index, text?}
                         ▼
               content.js executes
```

---

## Why the architecture looks like this

The rubric is published, and it is **not** an accuracy competition:

| Weight | Criterion | Status |
|:--:|---|---|
| 25% | Visual context accuracy | Face detection working; canvas text not yet |
| 20% | PII detection recall & precision | **100% precision, 92.5% text recall** on real pages |
| 20% | Redaction precision | **100%** on real pages |
| 20% | Client resource utilisation | **3.1 MB** heap text-only, 9.9 MB with vision |
| 15% | End-to-end latency | **8.9 ms** text-only, 134 ms with vision |

**35% of the score is resource use and latency.** That single fact drives every
significant decision: a 227 KB face detector instead of a 2 GB model
([ADR-005](docs/adr/005-small-vision-model.md)), a 403 KB tagger instead of a
278 MB one ([ADR-009](docs/adr/009-neural-tagger-not-shipped.md)), and a
latency budget that fails closed rather than blocking
([ADR-003](docs/adr/003-fail-closed.md)).

---

## Results

Every figure below is produced by a script in this repository. Commands to
reproduce are in [Evaluation](#evaluation).

### Detection, three corpora

| Corpus | What it is | Precision | Recall | F1 |
|---|---|---:|---:|---:|
| `datagen/` | Our generator | 99.4% | 80.5% | 88.9% |
| ai4privacy | External, downloaded, form-shaped | 91.9% | 31.2% | 46.5% |
| `harvest/` | **Real pages**, injected PII | **100.0%** | 69.2% | 81.8% |

They disagree, and [that is the point](docs/adr/004-three-corpus-evaluation.md).
Two production bugs were caught only by the disagreement.

On real pages, 58 of 71 misses are canvas-rendered — handled by the vision pass,
which the offline text harness does not run. **Text-pipeline recall excluding
canvas: 92.5%, at 100% precision.**

### End to end

```
field before:   ""
field after:    "my card was declined"
task succeeded: true        secrets in payload: 0
capture 12.1 ms · server 18.8 ms · total 33 ms
```

What the server actually receives from a page carrying real identifiers:

```
Aadhaar [[AADHAAR]] · PAN [[PAN]] · IFSC [[IFSC]]
Registered email [[EMAIL]], mobile [[PHONE]]
Reference ORDER-100000000000 · ticket 1234 5678 9012
```

Every identifier masked, both decoys untouched, password transmitted as
`{filled: false, length: 0}`.

### Vision

**12 faces detected in-browser** across two test images — matching an
independent Python run of the same model exactly (1 + 11). Cold 447 ms
including model load, warm 134 ms, heap 9.9 MB, zero fallbacks to `unscanned`.

---

## Known limitations

Stated plainly, because a judge will ask. Fuller treatment in the
[threat model](docs/THREAT_MODEL.md) and [metrics](docs/METRICS.md).

- **Canvas text is not detected.** YuNet finds faces, not rendered identifiers.
  Those regions are masked wholesale by the fail-closed path.
- **The recall ceiling is ~36.5%** on general PII. Names, addresses and cities
  have no pattern to match. The neural tagger exists but
  [over-fires on prose](docs/adr/009-neural-tagger-not-shipped.md) and is not
  shipped.
- **Context rules are hand-written.** They were tuned by inspecting failures. A
  learned verifier would set the boundary from data
  ([ADR-006](docs/adr/006-context-requirements.md)).
- **The real-page number moves between runs**, because it harvests live pages
  (81.9% → 81.8% across two runs).
- **`phone_in` scores 0% on ai4privacy by construction** — it targets Indian
  mobiles and that corpus is European. Recorded rather than excluded, because
  excluding it would flatter the result.
- **No public dataset validates Aadhaar, PAN, IFSC or UPI.** Zero occurrences
  across 4,000 external documents. Only the generator covers them.

---

## Layout

```
extension/          browser extension (Chrome MV3 + Firefox)
  src/lib/          detection, redaction, serialisation, perf, DOM, browser shim
  src/vision/       YuNet pre/post-processing and the inference engine
  src/content.js    runs in page — the only component that sees raw data
  src/background.js service worker — bridges client and server
  models/           yunet_face.onnx (227 KB)
server/             FastAPI — sanitised-context contract, leak audit, policy
datagen/            synthetic generator · real-page harvester · shared patterns
eval/               three scoring harnesses
ner/                experimental byte-level tagger (not in the pipeline)
docs/adr/           architecture decision records
```

---

## Running it

```bash
npm install && npm run build          # required: MV3 needs a bundled content script

python -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt
uvicorn server.main:app --reload --port 8000
```

Load the extension:

- **Chrome** — `chrome://extensions` → Developer mode → *Load unpacked* → `extension/`
- **Firefox** — `about:debugging` → *Load Temporary Add-on* → `extension/manifest.firefox.json`

---

## Tests

```bash
npm test                 # unit tests + the five privacy invariants
npm run test:invariants  # invariants alone
```

The invariant suite asserts the five properties from the
[threat model](docs/THREAT_MODEL.md) — no field value transmitted, every
verified span replaced, unscanned imagery redacted, failures increasing
redaction rather than reducing it, and no query string leaving the client.
These decide whether the system is *safe*; everything else measures whether it
is *accurate*.

CI runs them on every push, alongside a bundle check (a content script with ES
imports is a broken extension) and a 95% precision floor on the synthetic
corpus.

## Evaluation

```bash
# 1. Synthetic — regression, and the only pixel-level redaction ground truth
python datagen/generate.py --n 500 --no-screenshots --out datagen/out
node eval/detect.mjs datagen/out/manifest.jsonl eval/out/predictions.jsonl
python eval/score.py datagen/out/manifest.jsonl eval/out/predictions.jsonl

# 2. External — do we generalise beyond our own generator?
node eval/external.mjs datagen/external/pii300k-en.jsonl

# 3. Real pages — do we survive real prose?
python datagen/harvest.py --out datagen/harvest_out --urls datagen/urls.txt
node eval/detect.mjs datagen/harvest_out/manifest.jsonl eval/out/harvest-preds.jsonl
python eval/score.py datagen/harvest_out/manifest.jsonl eval/out/harvest-preds.jsonl
```

Add screenshots by dropping `--no-screenshots` (needs `playwright install chromium`).

---

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Trust boundary, detection passes, budgets |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Assets, threats in and out of scope, residual risks, invariants |
| [docs/METRICS.md](docs/METRICS.md) | What counts as a detection, exclusions, environment, seeds |
| [docs/MODEL_CARDS.md](docs/MODEL_CARDS.md) | Both models: intended use, measured performance, failure modes |
| [docs/DATA.md](docs/DATA.md) | Provenance and licensing, corpus strategy, the Indian-PII gap |
| [docs/adr/](docs/adr/README.md) | Nine architecture decision records |
| [docs/RELEASING.md](docs/RELEASING.md) | Versioning and release conventions |
| [CHANGELOG.md](CHANGELOG.md) | Measured deltas per milestone |
| [ner/README.md](ner/README.md) | The tagger, and why it is not shipped |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Tests, metrics floor, repository hygiene |

Start with the [threat model](docs/THREAT_MODEL.md) if you are evaluating this
as a privacy control, and [metrics](docs/METRICS.md) if you are evaluating the
numbers.
