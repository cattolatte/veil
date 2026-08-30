/**
 * Content script. Runs in the page, owns all sensitive data, and is the only
 * component that ever sees unredacted content.
 */
import { buildContext } from "./lib/serialize.js";
import { boxesFromRegions } from "./lib/redact.js";
import { VisionEngine } from "./vision/engine.js";

const vision = new VisionEngine();
let overlay = null;

/** Debug overlay: draws what WOULD be redacted. Required to demonstrate redaction. */
function drawOverlay(context, regions) {
  overlay?.remove();
  overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647",
  });
  const mark = (box, color, label) => {
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "absolute", left: `${box.x}px`, top: `${box.y}px`,
      width: `${box.w}px`, height: `${box.h}px`,
      outline: `2px solid ${color}`, background: `${color}22`,
      font: "10px monospace", color, boxSizing: "border-box",
    });
    d.textContent = label;
    overlay.appendChild(d);
  };
  for (const el of context.elements) if (el.sensitive) mark(el.box, "#e11", el.sensitive);
  for (const r of regions) mark(r, "#e80", r.kind);
  document.documentElement.appendChild(overlay);
  setTimeout(() => overlay?.remove(), 4000);
}

async function capture({ debug = false } = {}) {
  const t0 = performance.now();
  const context = buildContext();
  const regions = await vision.findSensitiveRegions(context.visualCandidates);
  context.visualRedactions = boxesFromRegions(regions, context.viewport.dpr);
  delete context.visualCandidates;          // raw boxes never leave the client
  context.totalMs = +(performance.now() - t0).toFixed(1);
  if (debug) drawOverlay(context, regions);
  return context;
}

/** Execute a server-returned action. */
function execute(action) {
  const el = document.querySelectorAll(
    "a,button,input,select,textarea,[role=button],[role=link],[role=textbox],[contenteditable=true]"
  )[action.index];
  switch (action.type) {
    case "click":  el?.click(); return !!el;
    case "type":   if (!el) return false; el.focus(); el.value = action.text ?? ""; 
                   el.dispatchEvent(new Event("input", { bubbles: true })); return true;
    case "scroll": scrollBy({ top: action.dy ?? 400, behavior: "smooth" }); return true;
    case "noop":   return true;
    default:       return false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.cmd === "capture") { capture(msg).then(respond); return true; }
  if (msg.cmd === "execute") { respond({ ok: execute(msg.action) }); return true; }
});
