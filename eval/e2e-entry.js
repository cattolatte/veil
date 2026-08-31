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
    const blocks = context.__rawChunks ?? [];
    const perBlock = await tagger.scanBlocks(blocks);
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const spans = perBlock[bi];
      if (!spans.length) { out.push(block); continue; }
      const bytes = new TextEncoder().encode(block);
      const dec = new TextDecoder();
      const mapped = spans.map((s) => ({
        kind: s.kind,
        start: dec.decode(bytes.subarray(0, s.start)).length,
        end: dec.decode(bytes.subarray(0, s.end)).length,
      })).sort((a, b) => a.start - b.start);
      out.push(redactText(block, mapped).text);
      added += mapped.length;
    }
    if (added) {
      context.text = out.join(" ").slice(0, 8000);
      context.stats.redactedSpans += added;
    }
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
