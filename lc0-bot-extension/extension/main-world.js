(function() {
  "use strict";

  const REQUEST_EVENT = "lc0bot-page-request";
  const RESPONSE_EVENT = "lc0bot-page-response";
  const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

  function respond(requestId, ok, result, error) {
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: { requestId, ok, result, error }
    }));
  }

  window.addEventListener(REQUEST_EVENT, (event) => {
    const request = event && event.detail ? event.detail : null;
    const requestId = typeof request?.requestId === "string" ? request.requestId : "";
    if (!requestId || typeof request.action !== "string") {
      return;
    }

    try {
      const dom = window.__LC0BotMain && window.__LC0BotMain.dom;
      if (!dom) {
        throw new Error("Chess.com page adapter is not ready");
      }

      switch (request.action) {
        case "GET_STATE": {
          const board = dom.getBoardElement();
          respond(requestId, true, {
            boardAvailable: !!board,
            fen: dom.resolveCurrentFen(),
            isMyTurn: dom.isMyTurn(),
            isLiveGame: dom.isLiveGameContext()
          });
          break;
        }
        case "MOVE": {
          const move = typeof request.move === "string" ? request.move.toLowerCase() : "";
          respond(requestId, true, { applied: UCI_MOVE.test(move) && dom.movePieceUci(move) });
          break;
        }
        case "HIGHLIGHT": {
          const move = typeof request.move === "string" ? request.move.toLowerCase() : "";
          if (UCI_MOVE.test(move)) {
            dom.highlightMoveUci(move);
          }
          respond(requestId, true, { highlighted: UCI_MOVE.test(move) });
          break;
        }
        case "CLEAR_HIGHLIGHTS":
          dom.clearHighlights();
          respond(requestId, true, { cleared: true });
          break;
        default:
          respond(requestId, false, null, "Unsupported page action");
      }
    } catch (error) {
      respond(requestId, false, null, error instanceof Error ? error.message : "Page action failed");
    }
  });
})();
