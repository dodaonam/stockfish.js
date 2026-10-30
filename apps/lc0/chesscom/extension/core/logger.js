(function() {
  "use strict";

  const LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  };

  const state = {
    level: "warn"
  };

  function normalizeLevel(level) {
    return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : "warn";
  }

  function shouldLog(level) {
    return LEVELS[normalizeLevel(level)] <= LEVELS[state.level];
  }

  function emit(level, args) {
    if (!shouldLog(level)) {
      return;
    }
    const prefix = `[LC0 Bot][${level.toUpperCase()}]`;
    const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    logger(prefix, ...args);
  }

  window.ChessBot = window.ChessBot || {};
  window.ChessBot.logger = {
    setLevel(level) {
      state.level = normalizeLevel(level);
    },
    getLevel() {
      return state.level;
    },
    error: (...args) => emit("error", args),
    warn: (...args) => emit("warn", args),
    info: (...args) => emit("info", args),
    debug: (...args) => emit("debug", args)
  };
})();
