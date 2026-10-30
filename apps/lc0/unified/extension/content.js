(function() {
  "use strict";

  let started = false;

  function applyEnabled(enabled) {
    if (window.ChessBot?.scheduler) {
      window.ChessBot.scheduler.setChessBotEnabled(enabled);
    }
  }

  const platform = location.hostname === "lichess.org" ? "lichess" : "chesscom";
  const enabledKey = `platform.${platform}.extensionEnabled`;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_EXTENSION" && message.platform === platform) {
      applyEnabled(message.enabled);
    }
  });

  // Keep tabs on the same site consistent without leaking settings across sites.
  const sharedSettings = [
    "autoRun", "autoMove", "showEvalBar", "searchMode", "goMovetimeSec",
    "goNodes", "randomDelayMinSec", "randomDelayMaxSec"
  ];
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const update = {};
    for (const key of sharedSettings) {
      const change = changes[`platform.${platform}.${key}`];
      if (change && Object.prototype.hasOwnProperty.call(change, "newValue")) {
        update[key] = change.newValue;
      }
    }
    if (Object.keys(update).length) {
      window.ChessBot?.ui?.controlPanel?.applyExternalSettings(update);
    }
  });

  async function start() {
    if (started || !window.ChessBot?.scheduler) return;
    started = true;
    const stored = await chrome.storage.local.get([enabledKey]);
    window.ChessBot.scheduler.start();
    applyEnabled(stored[enabledKey] !== false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { start().catch(console.error); }, { once: true });
  } else {
    start().catch(console.error);
  }
})();
