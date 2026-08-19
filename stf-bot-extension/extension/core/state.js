(function() {
  "use strict";

  window.ChessBot = window.ChessBot || {};
  const ChessBot = window.ChessBot;

  const config = {
    STARTING_FEN: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    DEFAULT_DEPTH: 12,
    DEPTH_MIN: 1,
    DEPTH_MAX: 20,
    DEFAULT_LIMIT_STRENGTH: false,
    DEFAULT_ELO: 2000,
    ELO_MIN: 1500,
    ELO_MAX: 3000,
    DEFAULT_RANDOM_DELAY_MIN_SEC: 0,
    DEFAULT_RANDOM_DELAY_MAX_SEC: 0,
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
    bestMoveForFen: null
  };

  const settings = {
    autoRun: false,
    autoMove: false,
    depth: config.DEFAULT_DEPTH,
    limitStrength: config.DEFAULT_LIMIT_STRENGTH,
    elo: config.DEFAULT_ELO,
    randomDelayMinSec: config.DEFAULT_RANDOM_DELAY_MIN_SEC,
    randomDelayMaxSec: config.DEFAULT_RANDOM_DELAY_MAX_SEC
  };

  ChessBot.state = {
    config,
    runtime,
    settings
  };
})();
