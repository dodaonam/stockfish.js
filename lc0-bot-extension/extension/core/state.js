(function() {
  "use strict";

  window.ChessBot = window.ChessBot || {};
  const ChessBot = window.ChessBot;

  const config = {
    STARTING_FEN: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    DEFAULT_MOVETIME_SEC: 0.5,
    DEFAULT_RANDOM_DELAY_MIN_SEC: 0.1,
    DEFAULT_RANDOM_DELAY_MAX_SEC: 0.6,
    DEFAULT_SEARCH_MODE: "classic",
    MOVETIME_SEC_MIN: 0.01,
    MOVETIME_SEC_MAX: 10,
    RANDOM_DELAY_SEC_MIN: 0,
    RANDOM_DELAY_SEC_MAX: 20,
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
    highlightForFen: null
  };

  const settings = {
    autoRun: false,
    autoMove: false,
    goMovetimeSec: config.DEFAULT_MOVETIME_SEC,
    randomDelayMinSec: config.DEFAULT_RANDOM_DELAY_MIN_SEC,
    randomDelayMaxSec: config.DEFAULT_RANDOM_DELAY_MAX_SEC,
    searchMode: config.DEFAULT_SEARCH_MODE
  };

  ChessBot.state = {
    config,
    runtime,
    settings
  };
})();
