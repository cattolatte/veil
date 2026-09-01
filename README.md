<div align="center">

# Veil

**Privacy-preserving on-device visual perception for browser agents**

A local model reads the screen and redacts sensitive content *before any network request*.
Only anonymised structure reaches the server — which returns an action the client executes.

[**Live demo**](https://cattolatte.github.io/veil/) · [Architecture](docs/ARCHITECTURE.md) · [Threat model](docs/THREAT_MODEL.md) · [Decisions](docs/adr/README.md) · [Metrics](docs/METRICS.md)

[![CI](https://github.com/cattolatte/veil/actions/workflows/ci.yml/badge.svg)](https://github.com/cattolatte/veil/actions/workflows/ci.yml)
[![Deploy demo](https://github.com/cattolatte/veil/actions/workflows/pages.yml/badge.svg)](https://github.com/cattolatte/veil/actions/workflows/pages.yml)
![Tests](https://img.shields.io/badge/tests-26%20passing-4ade80)
![Invariants](https://img.shields.io/badge/privacy%20invariants-5%2F5-4ade80)
![Latency](https://img.shields.io/badge/capture-8.9%20ms-818cf8)
![Heap](https://img.shields.io/badge/heap-3.1%20MB-818cf8)

<sub>Smart India Hackathon 2026 · Problem Statement <code>SIH26171</code> · ISRO / Department of Space</sub>

</div>

---

> **What the server actually receives**, from a page carrying real identifiers:
>
> ```
> Aadhaar [[AADHAAR]] · PAN [[PAN]] · IFSC [[IFSC]] · UPI [[UPI]]
> Email [[EMAIL]] · Mobile [[PHONE]]
> Order ref ORDER-100000000000 · Ticket 1234 5678 9012     ← decoys, correctly untouched
> password → {"filled": true, "length": 7}                  ← never the value
> ```

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
| 25% | Visual context accuracy | **Screen model: F1 90.1% on 910 held-out real pages** + face detection |
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

## Demo

**Live: https://cattolatte.github.io/veil/**

Only `demo/` is published; the rest of the repository stays private. To run it
locally:

```bash
npm install && npm run build      # also stages demo/veil-test.js
cd demo && python3 -m http.server 8799
```

Open `http://127.0.0.1:8799/index.html` and press **Run agent**. The left panel
is a real page full of genuine identifiers; the right panel is everything that
crossed the network. No server or extension install required. Script and
talking points in [docs/DEMO.md](docs/DEMO.md).

## Known limitations

Stated plainly, because a judge will ask. Fuller treatment in the
[threat model](docs/THREAT_MODEL.md) and [metrics](docs/METRICS.md).

- **Screen-model precision is 92.8%** on held-out real pages, so about one in
  fourteen masked regions did not need masking. It flags 3.7% of the screen.
- **The neural tagger is opt-in, not default.** It adds names, addresses,
  usernames and IPs — past the ~36.5% pattern ceiling — for about 10 ms. Off by
  default because it is the newest and least-tested channel.
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

## Optional: a local vision-language model

The server plans with a local **Qwen3-VL 8B** when one is available, so nothing
leaves the machine even at the planning step:

```bash
ollama pull qwen3-vl:8b-instruct
export OPENAI_BASE_URL=http://127.0.0.1:11434/v1
export VEIL_MODEL=qwen3-vl:8b-instruct
```

Planning is **tiered**: the rule planner answers in about a millisecond and
handles the common cases; the VLM runs only when the rules cannot decide. Set
`VEIL_ALWAYS_LLM=1` to force it on every request. `GET /planner` reports which
path is live.

Any OpenAI-compatible endpoint works — vLLM, llama.cpp, LM Studio, or a hosted
API. Without one, the rule planner answers alone and the system degrades rather
than fails. See [ADR-012](docs/adr/012-local-vlm-planner.md) for why 8B over 4B.

## Running it

```bash
# 1. Build (required — MV3 needs a bundled content script)
npm install && npm run build

# 2. Server
python3 -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt
python3 -m uvicorn server.main:app --reload --port 8000
```

If port 8000 is taken, use another and set it in the extension's Settings
panel. To run with the local vision model, prefix the server command:

```bash
OPENAI_BASE_URL=http://127.0.0.1:11434/v1 \
VEIL_MODEL=qwen3-vl:8b-instruct \
python3 -m uvicorn server.main:app --reload --port 8000
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

## Documentation

| Document | Contents |
|---|---|
| [docs/CONFORMANCE.md](docs/CONFORMANCE.md) | Every PS requirement, and where it is implemented |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Trust boundary, detection passes, budgets |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Assets, threats in and out of scope, residual risks, invariants |
| [docs/METRICS.md](docs/METRICS.md) | What counts as a detection, exclusions, environment, seeds |
| [docs/MODEL_CARDS.md](docs/MODEL_CARDS.md) | Both models: intended use, measured performance, failure modes |
| [docs/DATA.md](docs/DATA.md) | Provenance and licensing, corpus strategy, the Indian-PII gap |
| [docs/adr/](docs/adr/README.md) | Nine architecture decision records |
| [docs/RELEASING.md](docs/RELEASING.md) | Versioning and release conventions |
| [CHANGELOG.md](CHANGELOG.md) | Measured deltas per milestone |
| [docs/DEMO.md](docs/DEMO.md) | Two-minute demo script, and answers to the obvious questions |
| [docs/ONE_PAGER.md](docs/ONE_PAGER.md) | The whole project on one page |
| [vision/](vision/) | Screen-perception model: training, export, real-page evaluation |
| [ner/README.md](ner/README.md) | The tagger, and why it is not shipped |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Tests, metrics floor, repository hygiene |

Start with the [threat model](docs/THREAT_MODEL.md) if you are evaluating this
as a privacy control, and [metrics](docs/METRICS.md) if you are evaluating the
numbers.
