const $ = (id) => document.getElementById(id);

$("run").addEventListener("click", () => {
  $("out").textContent = "Running…";
  chrome.runtime.sendMessage(
    { cmd: "run", goal: $("goal").value, debug: $("debug").checked, screen: $("screen").checked },
    (res) => {
      if (chrome.runtime.lastError) { $("out").textContent = chrome.runtime.lastError.message; return; }
      if (!res)        { $("out").textContent = "No response."; return; }
      if (res.error)   { $("out").textContent = `Error: ${res.error}`; return; }
      const { stats, timing, plan, screen } = res;
      $("out").textContent = [
        `action    ${plan.action ? `${plan.action.type} @${plan.action.index ?? "-"}` : "none"}`,
        `reason    ${plan.reason ?? "-"}`,
        ``,
        `redacted  ${stats.redactedElements} elements, ${stats.redactedSpans} spans`,
        `kinds     ${Object.entries(stats.byKind).map(([k, v]) => `${k}:${v}`).join("  ") || "-"}`,
        `scanned   ${stats.scanned} elements`,
        ``,
        `client    ${timing.clientMs} ms`,
        ...(screen
          ? screen.error
            ? [`screen    failed: ${screen.error}`]
            : [`screen    ${screen.totalMs} ms · ${screen.regionsMasked} regions`,
               `          ${screen.screenMaskedPct}% of screen · ${screen.suppressedByDom} suppressed by DOM`,
               `          backend ${screen.backend}`]
          : []),
        `end-end   ${timing.roundTripMs} ms`,
      ].join("\n");
    }
  );
});
