chrome.runtime.onInstalled.addListener(() => {
  console.log("LC0 Bot extension installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "LC0_BESTMOVE") {
    return;
  }

  const requestId = typeof message.requestId === "string" ? message.requestId : "";
  const fen = typeof message.fen === "string" ? message.fen.trim() : "";
  const movetimeSec = Number.isFinite(message.movetimeSec) ? message.movetimeSec : 0.5;
  const searchMode = typeof message.searchMode === "string" ? message.searchMode : "classic";

  if (!requestId || !fen) {
    sendResponse({
      ok: false,
      requestId,
      error: {
        code: "INVALID_REQUEST",
        message: "Missing requestId or fen"
      }
    });
    return true;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  fetch("http://127.0.0.1:3187/v1/bestmove", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      request_id: requestId,
      fen,
      movetime_s: movetimeSec,
      search_mode: searchMode
    }),
    signal: controller.signal
  }).then(async response => {
    clearTimeout(timeoutId);
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!response.ok || !payload || payload.ok !== true) {
      sendResponse({
        ok: false,
        requestId,
        error: {
          code: payload && payload.code ? payload.code : "BRIDGE_ERROR",
          message: payload && payload.message ? payload.message : `Bridge returned HTTP ${response.status}`
        }
      });
      return;
    }

    sendResponse({
      ok: true,
      requestId,
      result: {
        bestmove: payload.bestmove || null,
        ponder: payload.ponder || null,
        elapsedMs: Number.isFinite(payload.elapsed_ms) ? payload.elapsed_ms : null,
        fenEcho: payload.fen_echo || null,
        searchMode: payload.search_mode || null
      }
    });
  }).catch(error => {
    clearTimeout(timeoutId);
    sendResponse({
      ok: false,
      requestId,
      error: {
        code: error && error.name === "AbortError" ? "BRIDGE_TIMEOUT" : "BRIDGE_UNREACHABLE",
        message: error && error.message ? error.message : "Failed to reach local bridge"
      }
    });
  });

  return true;
});
