/**
 * Test entry point. Exposes the client pipeline to a plain page so the full
 * loop — capture, sanitise, server, execute — can be driven without packaging
 * and installing the extension.
 *
 * This is the same code the extension runs; only the messaging layer is
 * replaced. It is not a reimplementation.
 */
import { buildContext } from "../extension/src/lib/serialize.js";
import { boxesFromRegions } from "../extension/src/lib/redact.js";
import { VisionEngine } from "../extension/src/vision/engine.js";
import { interactiveElements } from "../extension/src/lib/dom.js";

const vision = new VisionEngine();

export async function capture() {
  const t0 = performance.now();
  const context = buildContext();
  const regions = await vision.findSensitiveRegions(context.visualCandidates);
  context.visualRedactions = boxesFromRegions(regions, context.viewport.dpr);
  delete context.visualCandidates;
  context.totalMs = +(performance.now() - t0).toFixed(2);
  return context;
}

function setValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function execute(action) {
  const el = interactiveElements()[action.index];
  switch (action.type) {
    case "click":  el?.click(); return !!el;
    case "type":   if (!el) return false; el.focus(); setValue(el, action.text ?? ""); return true;
    case "scroll": scrollBy({ top: action.dy ?? 400 }); return true;
    case "noop":   return true;
    default:       return false;
  }
}

/** Full loop against a live server. */
export async function run(goal, serverUrl = "http://127.0.0.1:8000") {
  const t0 = performance.now();
  const context = await capture();
  const tCap = performance.now();
  const res = await fetch(`${serverUrl}/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, context }),
  });
  if (!res.ok) throw new Error(`server ${res.status}`);
  const plan = await res.json();
  const tSrv = performance.now();
  const executed = plan.action ? execute(plan.action) : null;
  return {
    plan, executed, context,
    timing: {
      captureMs: +(tCap - t0).toFixed(2),
      serverMs: +(tSrv - tCap).toFixed(2),
      totalMs: +(performance.now() - t0).toFixed(2),
    },
  };
}
