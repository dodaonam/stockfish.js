(function() {
  "use strict";

  const existingMainState = window.__LC0BotMain;
  const mainState = existingMainState && typeof existingMainState === "object" ? existingMainState : {};
  window.__LC0BotMain = mainState;

  const config = mainState.config || {
    HIGHLIGHT_COLOR: "rgb(235, 97, 80)",
    HIGHLIGHT_OPACITY: 0.68,
    COL_TO_NUM: { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6", g: "7", h: "8" }
  };
  const runtime = mainState.runtime || { board: null, highlightNodes: [] };
  mainState.config = config;
  mainState.runtime = runtime;

  const selectors = { board: ["chess-board", "wc-chess-board"] };

  function debug(message, error) {
    console.debug("[LC0 Bot] " + message, error);
  }

  function warn(message, error) {
    console.warn("[LC0 Bot] " + message, error);
  }

  function queryFirst(selectorList, root = document) {
    for (const selector of selectorList) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function normalizeColor(value) {
    if (value === 1 || value === "1" || value === "white" || value === "w") return "white";
    if (value === 2 || value === "2" || value === "black" || value === "b") return "black";
    return null;
  }

  function getBoardElement() {
    return queryFirst(selectors.board);
  }

  function resolveCurrentFen() {
    const board = runtime.board || getBoardElement();
    if (board?.game && typeof board.game.getFEN === "function") {
      try {
        return board.game.getFEN();
      } catch (error) {
        debug("Unable to read FEN from board.game", error);
      }
    }
    try {
      if (window.game && typeof window.game.getFEN === "function") return window.game.getFEN();
    } catch (error) {
      debug("Unable to read FEN from window.game", error);
    }
    return null;
  }

  function getPlayerColor() {
    const board = runtime.board || getBoardElement();
    if (!board?.game || typeof board.game.getPlayingAs !== "function") return null;
    try {
      return normalizeColor(board.game.getPlayingAs());
    } catch (error) {
      debug("Unable to read playing color", error);
      return null;
    }
  }

  function isMyTurn() {
    const board = runtime.board || getBoardElement();
    if (board?.game && typeof board.game.getTurn === "function" && typeof board.game.getPlayingAs === "function") {
      try {
        return board.game.getTurn() === board.game.getPlayingAs();
      } catch (error) {
        debug("Unable to determine turn from board.game", error);
      }
    }
    const fen = resolveCurrentFen();
    const color = getPlayerColor();
    if (!fen || !color) return false;
    const sideToMove = (fen.split(/\s+/)[1] || "w").toLowerCase();
    return color === "white" ? sideToMove === "w" : sideToMove === "b";
  }

  function getLegalMoves() {
    const board = runtime.board || getBoardElement();
    if (!board?.game || typeof board.game.getLegalMoves !== "function") return [];
    try {
      const moves = board.game.getLegalMoves();
      return Array.isArray(moves) ? moves : [];
    } catch (error) {
      debug("Unable to get legal moves", error);
      return [];
    }
  }

  function movePieceUci(uciMove) {
    if (typeof uciMove !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uciMove)) return false;
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length > 4 ? uciMove.slice(4, 5) : null;
    const board = runtime.board || getBoardElement();
    if (!board?.game || typeof board.game.move !== "function") return false;
    const matchingMove = getLegalMoves().find(move => move.from === from && move.to === to);
    if (!matchingMove) return false;
    try {
      board.game.move({ ...matchingMove, promotion: promotion || matchingMove.promotion || "false", animate: false, userGenerated: true });
      return true;
    } catch (error) {
      warn("Failed to apply move", { uciMove, error });
      return false;
    }
  }

  function convertSquareNotation(square) {
    return `${config.COL_TO_NUM[square.charAt(0)] || square.charAt(0)}${square.charAt(1)}`;
  }

  function clearHighlights() {
    document.querySelectorAll('[data-lc0-highlight="1"]').forEach(node => node.remove());
    runtime.highlightNodes = [];
  }

  function createHighlight(square) {
    const board = runtime.board || getBoardElement();
    if (!board) return;
    const node = document.createElement("div");
    node.className = `highlight square-${square} bro`;
    node.style.backgroundColor = config.HIGHLIGHT_COLOR;
    node.style.opacity = String(config.HIGHLIGHT_OPACITY);
    node.setAttribute("data-lc0-highlight", "1");
    board.prepend(node);
    runtime.highlightNodes.push(node);
  }

  function highlightMoveUci(uciMove) {
    if (typeof uciMove !== "string" || uciMove.length < 4) return;
    clearHighlights();
    createHighlight(convertSquareNotation(uciMove.slice(2, 4)));
    createHighlight(convertSquareNotation(uciMove.slice(0, 2)));
  }

  function isLiveGameContext() {
    const path = (window.location?.pathname || "").toLowerCase();
    return path.startsWith("/play/") || path.startsWith("/game/") || path.startsWith("/puzzles/");
  }

  mainState.dom = {
    getBoardElement,
    resolveCurrentFen,
    isMyTurn,
    movePieceUci,
    highlightMoveUci,
    clearHighlights,
    isLiveGameContext
  };
})();
