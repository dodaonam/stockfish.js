(function() {
  "use strict";

  const ChessBot = window.ChessBot;
  const { runtime } = ChessBot.state;

  function isTypingContext(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    return target.matches("input, textarea, select, [contenteditable=\"true\"]");
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    if (isTypingContext(event.target)) {
      return;
    }

    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (key !== "h" && key !== "z" && key !== "s" && key !== "b") {
      return;
    }

    if (key === "z" && runtime.uiHidden) {
      return;
    }

    const controlPanel = ChessBot.ui?.controlPanel;
    if (!controlPanel) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (key === "h") {
      controlPanel.setUiHidden(!runtime.uiHidden);
      return;
    }

    if (key === "s") {
      controlPanel.setSetting("autoRun", !ChessBot.state.settings.autoRun);
      return;
    }

    if (key === "b") {
      controlPanel.setSetting("showEvalBar", !ChessBot.state.settings.showEvalBar);
      return;
    }

    controlPanel.togglePanel();
  }

  document.addEventListener("keydown", handleKeydown, true);
})();