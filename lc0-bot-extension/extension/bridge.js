(function() {
  "use strict";

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "TOGGLE_EXTENSION") {
      emit("chess-bot-toggle", {
        enabled: message.enabled
      });
    }
  });

  chrome.storage.local.get(["extensionEnabled"], (result) => {
    emit("chess-bot-toggle", {
      enabled: result.extensionEnabled !== false
    });
  });

  window.addEventListener("chess-bot-storage-get", (event) => {
    const detail = event && event.detail ? event.detail : {};
    const requestId = detail.requestId || null;
    const keys = Array.isArray(detail.keys) ? detail.keys : [];

    chrome.storage.local.get(keys, (data) => {
      if (chrome.runtime.lastError) {
        emit("chess-bot-storage-get-response", {
          requestId,
          ok: false,
          error: {
            code: "STORAGE_GET_FAILED",
            message: chrome.runtime.lastError.message
          }
        });
        return;
      }

      emit("chess-bot-storage-get-response", {
        requestId,
        ok: true,
        data
      });
    });
  });

  window.addEventListener("chess-bot-storage-set", (event) => {
    const detail = event && event.detail ? event.detail : {};
    const requestId = detail.requestId || null;
    const values = detail.values && typeof detail.values === "object" ? detail.values : {};

    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        emit("chess-bot-storage-set-response", {
          requestId,
          ok: false,
          error: {
            code: "STORAGE_SET_FAILED",
            message: chrome.runtime.lastError.message
          }
        });
        return;
      }

      emit("chess-bot-storage-set-response", {
        requestId,
        ok: true
      });
    });
  });

  window.addEventListener("chess-bot-local-engine-request", (event) => {
    const detail = event && event.detail ? event.detail : {};
    const requestId = detail.requestId || null;

    if (!requestId || detail.action !== "BESTMOVE") {
      emit("chess-bot-local-engine-response", {
        requestId,
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid local engine request"
        }
      });
      return;
    }

    chrome.runtime.sendMessage({
      type: "LC0_BESTMOVE",
      requestId,
      fen: detail.fen,
      movetimeSec: detail.movetimeSec,
      searchMode: detail.searchMode
    }, (response) => {
      if (chrome.runtime.lastError) {
        emit("chess-bot-local-engine-response", {
          requestId,
          ok: false,
          error: {
            code: "RUNTIME_MESSAGE_FAILED",
            message: chrome.runtime.lastError.message
          }
        });
        return;
      }

      emit("chess-bot-local-engine-response", response || {
        requestId,
        ok: false,
        error: {
          code: "EMPTY_RESPONSE",
          message: "No response from background"
        }
      });
    });
  });
})();
