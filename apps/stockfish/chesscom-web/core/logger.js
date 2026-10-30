(function() {
    'use strict';

    const LEVELS = {
        error: 0,
        warn: 1,
        info: 2,
        debug: 3
    };

    const state = {
        level: 'warn'
    };

    function normalizeLevel(level) {
        return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : 'warn';
    }

    function shouldLog(level) {
        return LEVELS[normalizeLevel(level)] <= LEVELS[state.level];
    }

    function emit(level, args) {
        if (!shouldLog(level)) {
            return;
        }

        const prefix = `[Chess Bot][${level.toUpperCase()}]`;
        const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        logger(prefix, ...args);
    }

    function setLevel(level) {
        state.level = normalizeLevel(level);
    }

    function getLevel() {
        return state.level;
    }

    window.ChessBot = window.ChessBot || {};
    window.ChessBot.logger = {
        setLevel,
        getLevel,
        error: (...args) => emit('error', args),
        warn: (...args) => emit('warn', args),
        info: (...args) => emit('info', args),
        debug: (...args) => emit('debug', args)
    };
})();
