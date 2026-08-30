# Demo script

Two minutes, one screen, no narration required. The page proves the claim by
showing both sides at once.

## Hosted

The demo is published from `main` on every change:
**https://cattolatte.github.io/veil/**

Only `demo/` is deployed — the server, evaluation harnesses, training code and
decision records stay in the private repository. The page is marked `noindex`
and `robots.txt` disallows crawling, so it is reachable by link but not
discoverable by search.

**Be aware:** a GitHub Pages site is public even when the repository is
private. The published bundle contains the detection logic. That is a
deliberate trade — a link a panel can open beats a laptop they have to gather
around — but it is a real one.

## Local (no network, and the fallback if the hosted page is unreachable)

```bash
npm install && npm run build      # also stages demo/veil-test.js
cd demo && python3 -m http.server 8799
```

Open `http://127.0.0.1:8799/index.html`. Nothing else is needed — no server, no
extension install. **Practise the setup once**; a failed demo costs more than a
missing feature.

## The run

| Beat | Action | What to say |
|---|---|---|
| 1 | Point at the left panel | "This is a real page. Aadhaar, PAN, IFSC, UPI, email, mobile, a password, a card number. All genuine." |
| 2 | Point at the two decoys | "And two things that *look* like PII — an order reference and a ticket number. Watch those." |
| 3 | Click **Run agent** | — |
| 4 | Point at the right panel | "That is everything that crossed the network. Every identifier is a typed placeholder. The order reference and ticket are untouched — we don't over-redact." |
| 5 | Point at the password line | "The password went across as `{filled: true, length: 7}`. The server knows a password exists and is filled. It never learns the value." |
| 6 | Point at the metrics | "Four milliseconds. Zero leaks. Two of two decoys preserved." |

## The closing line

> "The rubric for this problem statement is published. **Thirty-five percent of
> it is client resource use and latency** — not accuracy. Most teams will ship a
> large model into a browser and lose that outright. We're at **4.5 ms and
> 2.3 MB**, with a **227 KB** face detector."

## If asked "what data did you test on?"

> "Three corpora that disagree with each other. Our own generator, an external
> downloaded corpus of 47,728 labelled documents, and real pages with injected
> PII. The disagreement is the point — it caught two bugs that any single
> corpus would have hidden."

## If asked "what doesn't work?"

Answer straight; it is the strongest move available.

> "Text rendered inside a canvas. Our face detector finds faces, not text, so
> those regions get masked wholesale instead of precisely. And we cover 36.5%
> of PII *types* — names and addresses have no pattern to match. We trained a
> tagger for that, measured it flagging 15% of ordinary page text, and didn't
> ship it."

## Fallback if the demo fails

Have `npm test` ready in a second terminal. Fifteen tests, five of which are
the privacy invariants. It runs in two seconds and proves the same claims
without a browser.
