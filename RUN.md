# Running Veil

Everything needed to get it working, in order. Two setups: the **quick demo**
(one command) and the **full extension** (three terminals).

---

## Quick demo — no server, no model

Shows detection and redaction only. Good for a link, or a fast look.

```bash
cd ~/Workspace/veil
npm install && npm run build
cd demo && python3 -m http.server 8799
```

Open **http://127.0.0.1:8799** and press **Run agent**.

Left panel: a page full of real identifiers. Right panel: everything that
would cross the network. Nothing else is running — this page talks to no server.

Also hosted at <https://cattolatte.github.io/veil/>.

---

## Full extension — three terminals

### One-time setup

```bash
cd ~/Workspace/veil
npm install && npm run build

python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt

ollama pull qwen3-vl:8b-instruct        # 6.1 GB
```

### Terminal 1 — the model

```bash
ollama serve
```

### Terminal 2 — the server

```bash
cd ~/Workspace/veil && source .venv/bin/activate

VEIL_ALWAYS_LLM=1 \
OPENAI_BASE_URL=http://127.0.0.1:11434/v1 \
VEIL_MODEL=qwen3-vl:8b-instruct \
python3 -m uvicorn server.main:app --reload --port 8010
```

**About the port.** 8000 is the default but is often already in use. 8010 is
used throughout this guide; whatever you pick must match the extension's
Settings.

**About `VEIL_ALWAYS_LLM=1`.** Planning is tiered: the rule planner answers most
requests in about a millisecond and the model only runs when the rules cannot
decide. That is right for scoring and useless for a demo, because the model
never visibly runs. This flag forces it every time.

**Drop the flag when measuring latency.** With it on, every request pays the
model's ~1.4 s.

### Terminal 3 — load the extension

**Chrome**

```
chrome://extensions  →  Developer mode  →  Load unpacked  →  select extension/
```

**Firefox**

```
about:debugging  →  This Firefox  →  Load Temporary Add-on  →  extension/manifest.firefox.json
```

### Point the extension at the server

Click the Veil icon → **⚙ Settings** → **Server URL** → `http://127.0.0.1:8010`
→ **Save**.

This is required if you changed the port. The default is 8000.

---

## Check it is wired up

```bash
curl -sS http://127.0.0.1:8010/planner
```

Expect:

```json
{"llm_configured": true, "model": "qwen3-vl:8b-instruct", "always_llm": true}
```

If `llm_configured` is `false`, the environment variables did not reach the
server — check Terminal 2.

---

## Using it

Open any real website, click the Veil icon, type a goal, press **Run agent**.

| Toggle | What it does | Cost |
|---|---|---|
| Show redaction overlay | Draws boxes over what will be hidden | free |
| Screen perception | Runs the vision model over a screenshot | ~200 ms |
| Names & addresses | Runs the neural tagger | ~10 ms |
| Multi-step | Loops up to 8 actions instead of one | per step |

Everything is off by default except the overlay. Turn things on deliberately.

---

## Suggested demo sequence

1. **Any page with a form.** Overlay on, everything else off. Run it. Point at
   the red boxes: *"that is what will never be sent."*
2. **Turn on Names & addresses.** Run again. More is caught — patterns cannot
   find a name, a model can.
3. **Turn on Screen perception.** Run again. Now it catches text drawn into
   images, which no amount of reading the page structure could find.
4. **Ask it to fill a password.** It refuses. *"The agent will not type into a
   sensitive field, even when asked directly."*
5. **Turn on Multi-step** for a two-part task.

---

## Troubleshooting

**Popup says "Cannot reach the server."**
Terminal 2 is not running, or the Settings URL does not match its port.

**Popup hangs, or says "No content script on this page."**
You are on a browser-internal page (`chrome://`, the Web Store, the PDF
viewer). Extensions cannot run there. Use an ordinary website.

**`llm_configured: false`.**
The environment variables were not set on the server command. They must be on
the same line as `uvicorn`, not exported separately in a different shell.

**"no available backend found" in the console.**
ONNX Runtime failed to start. Run `npm run build` — it stages the runtime files
into `extension/vendor/`. Then **reload the page**: the runtime caches a failed
start for the page's lifetime, so retrying without a reload shows the old error.

**Nothing happens when the extension loads.**
Run `npm run build`. The extension loads a bundled file that is not committed,
so a fresh clone has nothing to load until you build.

**Port already in use.**
Pick another and update Settings to match. Check what is holding it with
`lsof -nP -iTCP:8010 -sTCP:LISTEN`.

---

## Stopping

`Ctrl-C` in each terminal. Nothing is left running; the extension does nothing
until you click it.
