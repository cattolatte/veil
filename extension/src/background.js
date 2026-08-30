/**
 * Service worker. Bridges content script and server. Holds no page data.
 */
const DEFAULT_SERVER = "http://127.0.0.1:8000";

async function serverUrl() {
  const { serverUrl } = await chrome.storage.local.get("serverUrl");
  return serverUrl || DEFAULT_SERVER;
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.cmd !== "run") return;
  (async () => {
    const t0 = performance.now();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const context = await chrome.tabs.sendMessage(tab.id, { cmd: "capture", debug: msg.debug });

    const res = await fetch(`${await serverUrl()}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: msg.goal, context }),
    });
    if (!res.ok) { respond({ error: `server ${res.status}` }); return; }
    const plan = await res.json();

    let executed = null;
    if (plan.action) executed = await chrome.tabs.sendMessage(tab.id, { cmd: "execute", action: plan.action });

    respond({
      plan, executed,
      stats: context.stats,
      timing: {
        clientMs: context.totalMs,
        roundTripMs: +(performance.now() - t0).toFixed(1),
      },
    });
  })();
  return true;
});
