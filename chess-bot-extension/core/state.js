(function() {
    'use strict';

    window.ChessBot = window.ChessBot || {};
    const ChessBot = window.ChessBot;

    const config = {
        STOCKFISH_SCRIPT_SOURCES: [
            'https://cdn.jsdelivr.net/gh/dodaonam/stockfish.js@main/171_single_nnue/stockfish-17.1-single-a496a04.js',
            'https://raw.githubusercontent.com/dodaonam/stockfish.js/main/171_single_nnue/stockfish-17.1-single-a496a04.js'
        ],
        STOCKFISH_WASM_SOURCES: [
            'https://cdn.jsdelivr.net/gh/dodaonam/stockfish.js@main/171_single_nnue/stockfish-17.1-single-a496a04.wasm',
            'https://raw.githubusercontent.com/dodaonam/stockfish.js/main/171_single_nnue/stockfish-17.1-single-a496a04.wasm'
        ],
        STARTING_FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        DEFAULT_DEPTH: 11,
        HIGHLIGHT_DURATION_MS: 1800,
        HIGHLIGHT_COLOR: 'rgb(235, 97, 80)',
        HIGHLIGHT_OPACITY: 0.71,
        EVAL_ONLY_FAST_CAP_SECONDS: 0.35,
        COMMON_TIME_CONTROL_MINUTES: [0.5, 1, 1.5, 2, 3, 5, 10, 15, 30],
        AUTO_NEW_GAME_COOLDOWN_MS: 5000,
        DEPTH_HOTKEYS: {
            81: 1,
            87: 2,
            69: 3,
            82: 4,
            84: 5,
            89: 6,
            85: 7,
            73: 8,
            79: 9,
            80: 10,
            65: 11,
            83: 12,
            68: 13,
            70: 14,
            71: 15,
            72: 16,
            74: 17,
            75: 18,
            76: 19,
            90: 20,
            88: 21,
            67: 22,
            86: 23,
            66: 24,
            78: 25,
            77: 26,
            187: 100
        },
        COL_TO_NUM: {
            a: '1', b: '2', c: '3', d: '4',
            e: '5', f: '6', g: '7', h: '8'
        }
    };

    const runtime = {
        isThinking: false,
        myTurn: false,
        board: null,
        extensionEnabled: true,
        stockfishWorkerURLPromise: null,
        stockfishObjectURL: null,
        isInActiveGame: false,
        confirmedPlayerColor: null,
        loaded: false,
        lastValue: config.DEFAULT_DEPTH
    };

    const evaluationState = {
        type: null,
        value: null,
        depth: null
    };

    const engineMetrics = {
        nodes: 0,
        nps: 0,
        seldepth: 0,
        volatility: 0,
        lastScoreType: null,
        lastScoreValue: null
    };

    const tempoStats = {
        myTurnStartedAt: null,
        oppTurnStartedAt: null,
        myAverageMs: null,
        oppAverageMs: null,
        lastIsMyTurn: null
    };

    const searchContext = {
        sideToMove: 'w',
        isPlayerTurn: true,
        suppressMoveHint: false
    };

    const engine = document.engine = document.engine || {};

    const myVars = document.myVars = {
        autoRun: false,
        autoMove: false,
        evalOnly: false,
        autoNewGame: false,
        lastAutoNewGame: 0,
        detectedTimeControl: null,
        lastHumanDelaySec: null,
        lastObservedFen: null,
        lastAnalyzedFen: null,
        playingAs: null,
        isThinking: false
    };

    const myFunctions = document.myFunctions = document.myFunctions || {};

    ChessBot.state = {
        config,
        runtime,
        evaluationState,
        engineMetrics,
        tempoStats,
        searchContext,
        engine,
        myVars,
        myFunctions,
        ROOT_WINDOW: window
    };
})();
