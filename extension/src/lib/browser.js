/**
 * Cross-browser extension API.
 *
 * The PS requires Chrome and Firefox. Firefox exposes `browser.*` returning
 * promises; Chrome exposes `chrome.*`, which returns promises in MV3 but still
 * accepts callbacks. Using `chrome.*` with callbacks works in one and not
 * reliably in the other, so everything goes through this shim and stays
 * promise-based.
 */
export const api = (typeof browser !== "undefined" && browser.runtime) ? browser : chrome;

/** Reject rather than hang if a message never gets a reply. */
export function sendMessage(target, msg, { timeoutMs = 10_000 } = {}) {
  const send = target === null
    ? api.runtime.sendMessage(msg)
    : api.tabs.sendMessage(target, msg);
  return withTimeout(Promise.resolve(send), timeoutMs, "message timed out");
}

export function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); }),
  ]);
}
