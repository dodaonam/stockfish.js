(function() {
  "use strict";

  let started = false;

  function applyEnabled(enabled) {
    if (window.ChessBot?.scheduler) {
      window.ChessBot.scheduler.setChessBotEnabled(enabled);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_EXTENSION") applyEnabled(message.enabled);
  });

  async function start() {
    if (started || !window.ChessBot?.scheduler) return;
    started = true;
    const stored = await chrome.storage.local.get(["extensionEnabled"]);
    window.ChessBot.scheduler.start();
    applyEnabled(stored.extensionEnabled !== false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { start().catch(console.error); }, { once: true });
  } else {
    start().catch(console.error);
  }
})();
