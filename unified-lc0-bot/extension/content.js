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
