(function() {
  "use strict";

  window.ChessBot = window.ChessBot || {};
  const ChessBot = window.ChessBot;

  const config = {
    STARTING_FEN: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    DEFAULT_SEARCH_MODE: "movetime",
    STOCKFISH_SCRIPT_SOURCES: [
      "https://cdn.jsdelivr.net/gh/dodaonam/stockfish.js@main/stockfish_engine/171_single_nnue/stockfish-17.1-single-a496a04.js",
      "https://raw.githubusercontent.com/dodaonam/stockfish.js/main/stockfish_engine/171_single_nnue/stockfish-17.1-single-a496a04.js"
    ],
    STOCKFISH_WASM_SOURCES: [
      "https://cdn.jsdelivr.net/gh/dodaonam/stockfish.js@main/stockfish_engine/171_single_nnue/stockfish-17.1-single-a496a04.wasm",
      "https://raw.githubusercontent.com/dodaonam/stockfish.js/main/stockfish_engine/171_single_nnue/stockfish-17.1-single-a496a04.wasm"
    ],
    STOCKFISH_EVAL_DEPTH: 11,
    STOCKFISH_EVAL_RENDER_INTERVAL_MS: 100,
    DEFAULT_MOVETIME_SEC: 0.01,
    DEFAULT_NODES: 10000,
    DEFAULT_RANDOM_DELAY_MIN_SEC: 0,
    DEFAULT_RANDOM_DELAY_MAX_SEC: 0,
    MOVETIME_SEC_MIN: 0.001,
    MOVETIME_SEC_MAX: 10,
    NODES_MIN: 1,
    NODES_MAX: 10000,
    RANDOM_DELAY_SEC_MIN: 0,
    RANDOM_DELAY_SEC_MAX: 30,
    LOOP_INTERVAL_MS: 120,
    REQUEST_TIMEOUT_MS: 10000,
    HIGHLIGHT_DURATION_MS: 3000,
    HIGHLIGHT_COLOR: "rgb(235, 97, 80)",
    HIGHLIGHT_OPACITY: 0.68,
    COL_TO_NUM: {
      a: "1", b: "2", c: "3", d: "4",
      e: "5", f: "6", g: "7", h: "8"
    }
  };

  const runtime = {
    extensionEnabled: true,
    board: null,
    loaded: false,
    isThinking: false,
    requestSeq: 0,
    inFlightRequestId: null,
    inFlightFen: null,
    inFlightAnalysisKey: null,
    pendingFen: null,
    pendingAnalysisKey: null,
    pendingDueAt: 0,
    lastRequestedFen: null,
    lastRequestedAnalysisKey: null,
    lastAppliedFen: null,
    highlightForFen: null,
    bestMoveForFen: null,
    evalRequestSeq: 0,
    evalInFlightId: null,
    evalInFlightFen: null,
    evalInFlightKey: null,
    lastEvaluatedFen: null,
    lastEvaluationKey: null,
    playerColor: null,
    uiHidden: false,
    panelWasOpenBeforeHide: false
  };

  const evaluationState = {
    fen: null,
    sideToMove: null,
    type: null,
    value: null,
    depth: null,
    updatedAt: 0
  };

  const settings = {
    autoRun: false,
    autoMove: false,
    showEvalBar: false,
    searchMode: config.DEFAULT_SEARCH_MODE,
    goMovetimeSec: config.DEFAULT_MOVETIME_SEC,
    goNodes: config.DEFAULT_NODES,
    randomDelayMinSec: config.DEFAULT_RANDOM_DELAY_MIN_SEC,
    randomDelayMaxSec: config.DEFAULT_RANDOM_DELAY_MAX_SEC
  };

  ChessBot.state = {
    config,
    runtime,
    settings,
    evaluationState
  };
})();
