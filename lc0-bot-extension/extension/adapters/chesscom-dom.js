(function() {
  "use strict";

  const ChessBot = window.ChessBot;
  const { runtime, config } = ChessBot.state;

  const selectors = {
    board: ["chess-board", "wc-chess-board"],
    controlPanelRoot: ["#lc0-control-root"]
  };

  function queryFirst(selectorList, root = document) {
    for (const selector of selectorList) {
      const node = root.querySelector(selector);
      if (node) {
        return node;
      }
    }
    return null;
  }

  function normalizeColor(value) {
    if (value === 1 || value === "1" || value === "white" || value === "w") {
      return "white";
    }
    if (value === 2 || value === "2" || value === "black" || value === "b") {
      return "black";
    }
    return null;
  }

  function getBoardElement() {
    return queryFirst(selectors.board);
  }

  function resolveCurrentFen() {
    const board = runtime.board || getBoardElement();
    if (board && board.game && typeof board.game.getFEN === "function") {
      try {
        return board.game.getFEN();
      } catch (error) {
        ChessBot.logger.debug("Unable to read FEN from board.game", error);
      }
    }

    try {
      if (window.game && typeof window.game.getFEN === "function") {
        return window.game.getFEN();
      }
    } catch (error) {
      ChessBot.logger.debug("Unable to read FEN from window.game", error);
    }

    return null;
  }

  function getPlayerColor() {
    const board = runtime.board || getBoardElement();
    if (!board || !board.game || typeof board.game.getPlayingAs !== "function") {
      return null;
    }
    try {
      return normalizeColor(board.game.getPlayingAs());
    } catch (error) {
      ChessBot.logger.debug("Unable to read playing color", error);
      return null;
    }
  }

  function isMyTurn() {
    const board = runtime.board || getBoardElement();
    if (board && board.game && typeof board.game.getTurn === "function" && typeof board.game.getPlayingAs === "function") {
      try {
        return board.game.getTurn() === board.game.getPlayingAs();
      } catch (error) {
        ChessBot.logger.debug("Unable to determine turn from board.game", error);
      }
    }

    const fen = resolveCurrentFen();
    const color = getPlayerColor();
    if (!fen || !color) {
      return false;
    }

    const sideToMove = (fen.split(/\s+/)[1] || "w").toLowerCase();
    return color === "white" ? sideToMove === "w" : sideToMove === "b";
  }

  function getLegalMoves() {
    const board = runtime.board || getBoardElement();
    if (!board || !board.game || typeof board.game.getLegalMoves !== "function") {
      return [];
    }
    try {
      const moves = board.game.getLegalMoves();
      return Array.isArray(moves) ? moves : [];
    } catch (error) {
      ChessBot.logger.debug("Unable to get legal moves", error);
      return [];
    }
  }

  function movePieceUci(uciMove) {
    if (typeof uciMove !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uciMove)) {
      return false;
    }

    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length > 4 ? uciMove.slice(4, 5) : null;

    const board = runtime.board || getBoardElement();
    if (!board || !board.game || typeof board.game.move !== "function") {
      return false;
    }

    const legalMoves = getLegalMoves();
    const matchingMove = legalMoves.find(move => move.from === from && move.to === to);
    if (!matchingMove) {
      return false;
    }

    try {
      board.game.move({
        ...matchingMove,
        promotion: promotion || matchingMove.promotion || "false",
        animate: false,
        userGenerated: true
      });
      return true;
    } catch (error) {
      ChessBot.logger.warn("Failed to apply move", { uciMove, error });
      return false;
    }
  }

  function convertSquareNotation(square) {
    const file = square.charAt(0);
    return `${config.COL_TO_NUM[file] || file}${square.charAt(1)}`;
  }

  function createHighlight(square) {
    const node = document.createElement("div");
    node.className = `highlight square-${square} bro`;
    node.style.backgroundColor = config.HIGHLIGHT_COLOR;
    node.style.opacity = String(config.HIGHLIGHT_OPACITY);
    node.setAttribute("data-lc0-highlight", "1");

    const board = runtime.board || getBoardElement();
    if (!board) {
      return;
    }

    board.prepend(node);
    runtime.highlightNodes = runtime.highlightNodes || [];
    runtime.highlightNodes.push(node);
  }

  function clearHighlights() {
    document.querySelectorAll('[data-lc0-highlight="1"]').forEach(node => node.remove());
    runtime.highlightNodes = [];
  }

  function highlightMoveUci(uciMove) {
    if (typeof uciMove !== "string" || uciMove.length < 4) {
      return;
    }

    clearHighlights();
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    createHighlight(convertSquareNotation(to));
    createHighlight(convertSquareNotation(from));
  }

  function getControlPanelRoot() {
    return queryFirst(selectors.controlPanelRoot);
  }

  function isLiveGameContext() {
    const path = (window.location && window.location.pathname ? window.location.pathname : "").toLowerCase();
    return path.startsWith("/play/") || path.startsWith("/game/") || path.startsWith("/puzzles/");
  }

  ChessBot.dom = {
    selectors,
    queryFirst,
    getBoardElement,
    resolveCurrentFen,
    getPlayerColor,
    isMyTurn,
    getLegalMoves,
    movePieceUci,
    highlightMoveUci,
    clearHighlights,
    getControlPanelRoot,
    isLiveGameContext
  };
})();
