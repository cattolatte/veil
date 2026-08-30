const $ = (id) => document.getElementById(id);

$("run").addEventListener("click", () => {
  $("out").textContent = "Running…";
  chrome.runtime.sendMessage(
    { cmd: "run", goal: $("goal").value, debug: $("debug").checked },
    (res) => {
      if (chrome.runtime.lastError) { $("out").textContent = chrome.runtime.lastError.message; return; }
      if (!res)        { $("out").textContent = "No response."; return; }
      if (res.error)   { $("out").textContent = `Error: ${res.error}`; return; }
      const { stats, timing, plan } = res;
      $("out").textContent = [
        `action    ${plan.action ? `${plan.action.type} @${plan.action.index ?? "-"}` : "none"}`,
        `reason    ${plan.reason ?? "-"}`,
        ``,
        `redacted  ${stats.redactedElements} elements, ${stats.redactedSpans} spans`,
        `kinds     ${Object.entries(stats.byKind).map(([k, v]) => `${k}:${v}`).join("  ") || "-"}`,
        `scanned   ${stats.scanned} elements`,
        ``,
        `client    ${timing.clientMs} ms`,
        `end-end   ${timing.roundTripMs} ms`,
      ].join("\n");
    }
  );
});
