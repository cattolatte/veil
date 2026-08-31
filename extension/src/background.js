/**
 * Service worker. Bridges content script and server. Holds no page data.
 */
import { api, sendMessage, withTimeout } from "./lib/browser.js";
import { captureAndRedact } from "./screen-capture.js";
import { fuse } from "./vision/fuse.js";

const DEFAULT_SERVER = "http://127.0.0.1:8000";
const SERVER_TIMEOUT_MS = 8000;

async function serverUrl() {
  const { serverUrl } = await api.storage.local.get("serverUrl");
  return serverUrl || DEFAULT_SERVER;
}

/**
 * Content scripts are not injected into privileged pages (chrome://, the Web
 * Store, the PDF viewer, about:blank). sendMessage then rejects, and without
 * this the failure never reaches respond() and the popup hangs on "Running…"
 * forever.
 */
function friendlyError(err) {
  const m = String(err?.message ?? err);
  if (/Receiving end does not exist|Could not establish connection/i.test(m)) {
    return "No content script on this page. Browser-internal pages cannot be scanned — try a normal website.";
  }
  if (/timed out/i.test(m)) return "Timed out waiting for the page.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Cannot reach the server. Is it running on port 8000?";
  return m;
}

async function run(msg) {
  const t0 = performance.now();

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");

  const context = await sendMessage(tab.id, { cmd: "capture", debug: msg.debug });
  const tCapture = performance.now();

  // Screen perception. Opt-in per run because it costs ~200 ms against 8.9 ms
  // for the DOM pass, and latency is 15% of the score: most pages hold no
  // canvas-rendered PII for it to find.
  //
  // Ordering is the guarantee. The frame is captured, evaluated and MASKED
  // inside this worker before anything is serialised - the sensitive pixels
  // stop existing before the request is built, not after.
  let screenshot = null;
  let screenStats = null;
  if (msg.screen) {
    try {
      const shot = await captureAndRedact();

      // The DOM arbitrates. Where it accounts for a region as ordinary text it
      // examined and found clean, a screen flag there is more likely a false
      // positive than a discovery. Where the DOM demonstrably cannot see, the
      // screen model is the only witness and its flag stands.
      const fused = fuse(shot.regions, context);

      screenshot = shot.redactedPng;
      screenStats = { ...shot.stats, suppressedByDom: fused.suppressed, kept: fused.kept };
      context.screenRegions = fused.regions;
    } catch (err) {
      // Never fail the whole run because the vision pass failed. No screenshot
      // is sent, which is the safe direction.
      screenStats = { error: String(err?.message ?? err) };
    }
  }
  const tScreen = performance.now();

  // Unbounded fetch is the worst case for a metric that is 15% of the score:
  // a dead server would hang the popup rather than report a number.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SERVER_TIMEOUT_MS);
  let plan;
  try {
    const res = await fetch(`${await serverUrl()}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: msg.goal, context, screenshot }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    plan = await res.json();
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`Server did not respond within ${SERVER_TIMEOUT_MS} ms.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const tServer = performance.now();

  let executed = null;
  if (plan.action) {
    executed = await sendMessage(tab.id, { cmd: "execute", action: plan.action }).catch((e) => ({ ok: false, error: String(e) }));
  }

  return {
    plan, executed,
    stats: context.stats,
    cost: context.cost,
    screen: screenStats,
    timing: {
      clientMs: context.totalMs,
      captureMs: +(tCapture - t0).toFixed(1),
      screenMs: +(tScreen - tCapture).toFixed(1),
      serverMs: +(tServer - tScreen).toFixed(1),
      roundTripMs: +(performance.now() - t0).toFixed(1),
    },
  };
}

api.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.cmd !== "run") return;
  withTimeout(run(msg), 30_000, "run timed out")
    .then(respond)
    .catch((err) => respond({ error: friendlyError(err) }));
  return true;   // keeps the message channel open for the async reply
});
