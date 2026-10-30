(function() {
  "use strict";

  const ChessBot = window.ChessBot || {};
  const PAGE_REQUEST_EVENT = "lc0u-page-request";
  const PAGE_RESPONSE_EVENT = "lc0u-page-response";

  function makeRequestId(prefix = "req") {
    return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  }

  // Settings are independent on each platform, as in the original extensions.
  const platform = location.hostname === "lichess.org" ? "lichess" : "chesscom";
  const scoped = (key) => `platform.${platform}.${key}`;

  async function storageGet(keys) {
    const values = await chrome.storage.local.get(keys.map(scoped));
    return Object.fromEntries(keys.map(key => [key, values[scoped(key)]]));
  }

  function storageSet(values) {
    return chrome.storage.local.set(Object.fromEntries(
      Object.entries(values).map(([key, value]) => [scoped(key), value])
    ));
  }

  function requestPage(action, payload = {}, timeoutMs = 4_000) {
    const requestId = makeRequestId("page");
    return new Promise((resolve, reject) => {
      const onResponse = (event) => {
        const response = event && event.detail ? event.detail : null;
        if (!response || response.requestId !== requestId) {
          return;
        }
        cleanup();
        if (response.ok) {
          resolve(response.result || {});
        } else {
          reject(new Error(typeof response.error === "string" ? response.error : "Page action failed"));
        }
      };
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for page action: ${action}`));
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timeoutId);
        window.removeEventListener(PAGE_RESPONSE_EVENT, onResponse);
      }
      window.addEventListener(PAGE_RESPONSE_EVENT, onResponse);
      window.dispatchEvent(new CustomEvent(PAGE_REQUEST_EVENT, {
        detail: { requestId, action, ...payload }
      }));
    });
  }

  async function requestBestMove({ requestId, fen, searchMode, movetimeSec, nodes }) {
    return chrome.runtime.sendMessage({
      type: "LC0_BESTMOVE",
      requestId,
      fen,
      searchMode,
      movetimeSec,
      nodes
    });
  }

  ChessBot.bridge = {
    makeRequestId,
    storageGet,
    storageSet,
    requestBestMove,
    getPageState: () => requestPage("GET_STATE"),
    movePieceUci: (move) => requestPage("MOVE", { move }),
    highlightMoveUci: (move) => requestPage("HIGHLIGHT", { move }),
    clearHighlights: () => requestPage("CLEAR_HIGHLIGHTS")
  };
  window.ChessBot = ChessBot;
})();
