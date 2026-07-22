(function() {
  "use strict";

  const ChessBot = window.ChessBot || {};

  function makeRequestId(prefix = "req") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function sendBridgeRequest(requestEventName, responseEventName, detail, timeoutMs = 7000) {
    const requestId = detail.requestId || makeRequestId("bridge");

    return new Promise((resolve, reject) => {
      let timeoutId = null;

      function cleanup(handler) {
        window.removeEventListener(responseEventName, handler);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }

      function onResponse(event) {
        const response = event && event.detail ? event.detail : null;
        if (!response || response.requestId !== requestId) {
          return;
        }
        cleanup(onResponse);
        resolve(response);
      }

      window.addEventListener(responseEventName, onResponse);
      timeoutId = setTimeout(() => {
        cleanup(onResponse);
        reject(new Error(`Bridge request timed out: ${requestEventName}`));
      }, timeoutMs);

      window.dispatchEvent(new CustomEvent(requestEventName, {
        detail: {
          ...detail,
          requestId
        }
      }));
    });
  }

  async function storageGet(keys) {
    const response = await sendBridgeRequest(
      "chess-bot-storage-get",
      "chess-bot-storage-get-response",
      { keys: Array.isArray(keys) ? keys : [] },
      4000
    );

    if (!response.ok) {
      throw new Error(response.error && response.error.message ? response.error.message : "Storage get failed");
    }

    return response.data || {};
  }

  async function storageSet(values) {
    const response = await sendBridgeRequest(
      "chess-bot-storage-set",
      "chess-bot-storage-set-response",
      { values: values && typeof values === "object" ? values : {} },
      4000
    );

    if (!response.ok) {
      throw new Error(response.error && response.error.message ? response.error.message : "Storage set failed");
    }

    return true;
  }

  async function requestBestMove({ requestId, fen, movetimeSec, searchMode, timeoutMs }) {
    return sendBridgeRequest(
      "chess-bot-local-engine-request",
      "chess-bot-local-engine-response",
      {
        requestId,
        action: "BESTMOVE",
        fen,
        movetimeSec,
        searchMode
      },
      Number.isFinite(timeoutMs) ? timeoutMs : 10000
    );
  }

  window.ChessBot = ChessBot;
  ChessBot.bridge = {
    makeRequestId,
    storageGet,
    storageSet,
    requestBestMove
  };
})();
