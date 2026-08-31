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
import { PiiTagger } from "../extension/src/vision/tagger.js";
import { redactText } from "../extension/src/lib/redact.js";

const vision = new VisionEngine();
const tagger = new PiiTagger();

export async function capture({ neural = false } = {}) {
  const t0 = performance.now();
  const context = buildContext({ retainRawText: neural });
  if (neural) {
    const tN = performance.now();
    let added = 0;
    const out = [];
    const retained = context.__rawChunks ?? [];
    const perBlock = await tagger.scanBlocks(retained.map((r) => r.raw));

    for (let bi = 0; bi < retained.length; bi++) {
      const { raw, spans: patternSpans } = retained[bi];
      const nspans = perBlock[bi];
      if (!nspans.length) { out.push(redactText(raw, patternSpans).text); continue; }

      const bytes = new TextEncoder().encode(raw);
      const dec = new TextDecoder();
      const mapped = nspans.map((sp) => ({
        kind: sp.kind,
        start: dec.decode(bytes.subarray(0, sp.start)).length,
        end: dec.decode(bytes.subarray(0, sp.end)).length,
      }));

      const all = [...patternSpans, ...mapped]
        .filter((sp) => sp.end > sp.start)
        .sort((a, b) => a.start - b.start || b.end - a.end);
      const merged = [];
      for (const sp of all) {
        const last = merged[merged.length - 1];
        if (last && sp.start < last.end) { last.end = Math.max(last.end, sp.end); continue; }
        merged.push({ ...sp });
      }
      out.push(redactText(raw, merged).text);
      added += Math.max(0, merged.length - patternSpans.length);
    }
    context.text = out.join(" ").slice(0, 8000);
    if (added) context.stats.redactedSpans += added;
    context.neural = { added, ms: +(performance.now() - tN).toFixed(1), backend: tagger.backend };
  }
  delete context.__rawChunks;
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
