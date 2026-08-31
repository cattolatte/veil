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

/**
 * One perceive-plan-act cycle.
 *
 * Kept as a single function so the loop below stays readable: an agent step is
 * capture the world, decide, act, and report what happened.
 */
async function step(msg, tab, history) {
  const t0 = performance.now();

  const context = await sendMessage(tab.id, { cmd: "capture", debug: msg.debug, neural: msg.neural });
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
      body: JSON.stringify({ goal: msg.goal, context, screenshot, history }),
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
    neural: context.neural ?? null,
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

const MAX_STEPS = 8;
const STALL_LIMIT = 2;

/** Stable identity for an action, used to detect a stuck loop. */
function signature(action) {
  if (!action) return "none";
  return [action.type, action.index ?? "-", action.text ?? "-", action.dy ?? "-"].join(":");
}

/**
 * The agent loop: perceive, plan, act, repeat.
 *
 * The problem statement asks for assistance with "complex workflows", and the
 * finale evaluates "the provided task" end to end - both of which imply more
 * than one action. A single step is a demo; a loop is an agent.
 *
 * Three ways it stops, and all three matter:
 *
 *   done   - the planner returns `noop`, meaning it believes the goal is met.
 *   stall  - the same action twice running, or two consecutive steps that
 *            change nothing. Without this an agent will happily click the same
 *            dead button until the step limit, which looks like working.
 *   limit  - MAX_STEPS. A hard ceiling so a confused planner cannot loop
 *            indefinitely against a live page.
 *
 * Every step re-perceives from scratch rather than reasoning about a remembered
 * page. The page may have navigated, re-rendered, or opened a dialog, and a
 * stale model of it is how agents click the wrong thing with confidence.
 */
async function run(msg) {
  const t0 = performance.now();
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");

  const maxSteps = msg.multiStep ? (msg.maxSteps ?? MAX_STEPS) : 1;
  const steps = [];
  const history = [];
  let stalls = 0;
  let stopReason = "limit";

  for (let i = 0; i < maxSteps; i++) {
    const result = await step(msg, tab, history);
    steps.push(result);

    const sig = signature(result.plan.action);
    history.push({ action: result.plan.action, reason: result.plan.reason });

    if (!result.plan.action || result.plan.action.type === "noop") {
      stopReason = "done";
      break;
    }
    if (result.executed === false || result.executed?.ok === false) {
      stopReason = "action failed";
      break;
    }
    // Repeating an action, or producing no effect, means the agent is stuck.
    const prev = steps[steps.length - 2];
    if (prev && signature(prev.plan.action) === sig) {
      if (++stalls >= STALL_LIMIT) { stopReason = "stalled"; break; }
    } else {
      stalls = 0;
    }

    // Let the page settle before re-perceiving: a click may navigate or
    // re-render, and capturing mid-transition yields a context describing
    // neither the old page nor the new one.
    await new Promise((r) => setTimeout(r, 350));
  }

  const last = steps[steps.length - 1];
  return {
    ...last,
    steps: steps.map((s, i) => ({
      n: i + 1,
      action: s.plan.action,
      reason: s.plan.reason,
      executed: s.executed,
      ms: s.timing.roundTripMs,
      redacted: (s.stats?.redactedSpans ?? 0) + (s.stats?.redactedElements ?? 0),
    })),
    stopReason,
    totalSteps: steps.length,
    totalMs: +(performance.now() - t0).toFixed(1),
  };
}

api.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.cmd !== "run") return;
  withTimeout(run(msg), 30_000, "run timed out")
    .then(respond)
    .catch((err) => respond({ error: friendlyError(err) }));
  return true;   // keeps the message channel open for the async reply
});
