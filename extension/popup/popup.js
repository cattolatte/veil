/**
 * Popup: run the agent, configure it, review past runs.
 *
 * State lives in chrome.storage.local rather than in the popup, because a
 * popup is destroyed the moment it loses focus. Anything held only here is
 * gone the instant the user clicks the page.
 */
import { api } from "../src/lib/browser.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const DEFAULTS = {
  serverUrl: "http://127.0.0.1:8000",
  maxSteps: 8,
  screenDefault: false,
  neuralDefault: false,
  multiDefault: false,
  keepHistory: true,
};
const HISTORY_LIMIT = 20;

// ── settings ──────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = { ...DEFAULTS, ...(await api.storage.local.get(Object.keys(DEFAULTS))) };
  $("set-server").value = s.serverUrl;
  $("set-steps").value = s.maxSteps;
  $("set-screen").checked = s.screenDefault;
  $("set-neural").checked = s.neuralDefault;
  $("set-multi").checked = s.multiDefault;
  $("set-history").checked = s.keepHistory;
  $("screen").checked = s.screenDefault;
  $("neural").checked = s.neuralDefault;
  $("multi").checked = s.multiDefault;
  return s;
}

async function saveSettings() {
  const steps = Math.min(20, Math.max(1, parseInt($("set-steps").value, 10) || 8));
  await api.storage.local.set({
    serverUrl: $("set-server").value.trim() || DEFAULTS.serverUrl,
    maxSteps: steps,
    screenDefault: $("set-screen").checked,
    neuralDefault: $("set-neural").checked,
    multiDefault: $("set-multi").checked,
    keepHistory: $("set-history").checked,
  });
  $("status").textContent = "Settings saved.";
  show("run");
}

// ── history ───────────────────────────────────────────────────────────────
async function pushHistory(entry) {
  const { keepHistory = true } = await api.storage.local.get("keepHistory");
  if (!keepHistory) return;
  const { history = [] } = await api.storage.local.get("history");
  history.unshift(entry);
  await api.storage.local.set({ history: history.slice(0, HISTORY_LIMIT) });
}

async function renderHistory() {
  const { history = [] } = await api.storage.local.get("history");
  if (!history.length) {
    $("hist").innerHTML = `<div class="empty">No runs yet.</div>`;
    return;
  }
  $("hist").innerHTML = history.map((h) => `
    <div class="h">
      <div class="g">${esc(h.goal)}</div>
      <div class="meta">${esc(h.host)} · ${h.steps} step${h.steps === 1 ? "" : "s"} ·
        ${h.redacted} redacted · ${h.ms} ms · ${esc(h.stopReason)}</div>
    </div>`).join("");
}

// ── view switching ────────────────────────────────────────────────────────
function show(which) {
  $("view-run").style.display = which === "run" ? "" : "none";
  $("view-settings").classList.toggle("on", which === "settings");
  $("view-history").classList.toggle("on", which === "history");
  if (which === "history") renderHistory();
}

// ── rendering a result ────────────────────────────────────────────────────
const metric = (n, l, cls = "") =>
  `<div class="m"><div class="n ${cls}">${n}</div><div class="l">${l}</div></div>`;

function render(res) {
  const { stats = {}, timing = {}, screen, neural, steps = [], stopReason, totalSteps, totalMs } = res;
  const redacted = (stats.redactedSpans ?? 0) + (stats.redactedElements ?? 0);

  $("metrics").className = "metrics on";
  $("metrics").innerHTML =
    metric(`${totalMs ?? timing.roundTripMs} ms`, "total") +
    metric(redacted, "redacted", redacted ? "ok" : "") +
    metric(totalSteps ?? 1, "steps") +
    metric(`${timing.clientMs ?? "–"} ms`, "capture") +
    metric(screen ? (screen.error ? "err" : `${screen.regionsMasked}`) : "off",
           "screen regions", screen?.error ? "bad" : "") +
    metric(neural ? (neural.error ? "err" : neural.added) : "off",
           "neural finds", neural?.error ? "bad" : (neural?.added ? "ok" : "")) +
    metric(`${timing.serverMs ?? "–"} ms`, "server");

  if (steps.length > 1) {
    $("steps").className = "steps on";
    $("steps").innerHTML = steps.map((s) => `
      <div class="step">
        <div class="n">${s.n}</div>
        <div class="body">
          <div class="act">${esc(s.action ? `${s.action.type}${s.action.index != null ? " @" + s.action.index : ""}` : "noop")}</div>
          <div class="why">${esc(s.reason || "")}</div>
        </div>
        <div class="t">${s.ms} ms</div>
      </div>`).join("");
  } else {
    $("steps").className = "steps";
  }

  const ok = stopReason === "done" || stopReason === undefined;
  $("verdict").className = `verdict ${ok ? "ok" : "err"}`;
  $("verdict").textContent = ok
    ? `Completed in ${totalSteps ?? 1} step${(totalSteps ?? 1) === 1 ? "" : "s"}. Nothing sensitive transmitted.`
    : `Stopped: ${stopReason}.`;
}

// ── run ───────────────────────────────────────────────────────────────────
$("run").addEventListener("click", async () => {
  const s = await loadSettings();
  $("run").disabled = true;
  $("status").textContent = "Running…";
  $("verdict").className = "verdict";
  $("steps").className = "steps";

  const msg = {
    cmd: "run",
    goal: $("goal").value,
    debug: $("debug").checked,
    screen: $("screen").checked,
    neural: $("neural").checked,
    multiStep: $("multi").checked,
    maxSteps: s.maxSteps,
  };

  api.runtime.sendMessage(msg, async (res) => {
    $("run").disabled = false;
    if (api.runtime.lastError) { fail(api.runtime.lastError.message); return; }
    if (!res) { fail("No response."); return; }
    if (res.error) { fail(res.error); return; }

    render(res);
    $("status").textContent = `Done in ${res.totalMs ?? res.timing?.roundTripMs} ms.`;

    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    await pushHistory({
      goal: msg.goal,
      host: (() => { try { return new URL(tab?.url ?? "").host || "page"; } catch { return "page"; } })(),
      steps: res.totalSteps ?? 1,
      redacted: (res.stats?.redactedSpans ?? 0) + (res.stats?.redactedElements ?? 0),
      ms: res.totalMs ?? res.timing?.roundTripMs,
      stopReason: res.stopReason ?? "done",
      at: Date.now(),
    });
  });
});

function fail(message) {
  $("verdict").className = "verdict err";
  $("verdict").textContent = message;
  $("status").textContent = "Failed.";
}

$("tab-settings").addEventListener("click", () => show("settings"));
$("tab-history").addEventListener("click", () => show("history"));
$("set-save").addEventListener("click", saveSettings);
$("set-close").addEventListener("click", () => show("run"));
$("hist-close").addEventListener("click", () => show("run"));
$("hist-clear").addEventListener("click", async () => {
  await api.storage.local.set({ history: [] });
  renderHistory();
});

loadSettings();
