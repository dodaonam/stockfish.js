(function() {
    'use strict';

    const ChessBot = window.ChessBot;
    const {
        config,
        runtime,
        engine,
        myVars,
        myFunctions,
        evaluationState,
        engineMetrics,
        searchContext
    } = ChessBot.state;

    const BOOTSTRAP_PATTERN = 'a=decodeURIComponent(e[0]||location.origin+location.pathname.replace(/\\.js$/i,".wasm"))';

    function normalizeEngineScore(type, value) {
        if (type === 'mate') {
            if (!Number.isFinite(value)) {
                return null;
            }
            const sign = value > 0 ? 1 : -1;
            const magnitude = Math.max(0, 12 - Math.min(12, Math.abs(value)));
            return sign * (1000 + magnitude * 50);
        }
        return Number.isFinite(value) ? value : null;
    }

    function handleEngineInfoLine(message) {
        if (typeof message !== 'string') {
            return;
        }

        const nodesMatch = message.match(/\bnodes\s+(\d+)/);
        if (nodesMatch) {
            engineMetrics.nodes = parseInt(nodesMatch[1], 10);
        }

        const npsMatch = message.match(/\bnps\s+(\d+)/);
        if (npsMatch) {
            engineMetrics.nps = parseInt(npsMatch[1], 10);
        }

        const selDepthMatch = message.match(/\bseldepth\s+(\d+)/);
        if (selDepthMatch) {
            engineMetrics.seldepth = parseInt(selDepthMatch[1], 10);
        }

        if (!message.includes('score')) {
            return;
        }

        const multiPvMatch = message.match(/\bmultipv\s+(\d+)/);
        if (multiPvMatch && parseInt(multiPvMatch[1], 10) !== 1) {
            return;
        }

        let nextType = null;
        let nextValue = null;

        const mateMatch = message.match(/score\s+mate\s+(-?\d+)/);
        if (mateMatch) {
            nextType = 'mate';
            nextValue = parseInt(mateMatch[1], 10);
        } else {
            const cpMatch = message.match(/score\s+cp\s+(-?\d+)/);
            if (cpMatch) {
                nextType = 'cp';
                nextValue = parseInt(cpMatch[1], 10);
            }
        }

        if (nextType === null || !Number.isFinite(nextValue)) {
            return;
        }

        const depthMatch = message.match(/\bdepth\s+(\d+)/);
        evaluationState.type = nextType;
        evaluationState.value = nextValue;
        evaluationState.depth = depthMatch ? parseInt(depthMatch[1], 10) : evaluationState.depth;

        const normalizedScore = normalizeEngineScore(nextType, nextValue);
        const previousScore = normalizeEngineScore(engineMetrics.lastScoreType, engineMetrics.lastScoreValue);

        if (normalizedScore !== null) {
            if (previousScore !== null) {
                const delta = Math.abs(normalizedScore - previousScore);
                engineMetrics.volatility = ChessBot.timing.updateMovingAverage(engineMetrics.volatility, delta, 0.3);
            } else {
                engineMetrics.volatility = ChessBot.timing.updateMovingAverage(engineMetrics.volatility, Math.abs(normalizedScore) * 0.1, 0.3);
            }
            engineMetrics.lastScoreType = nextType;
            engineMetrics.lastScoreValue = nextValue;
        }

        ChessBot.evalBar.updateEvaluationBarDisplay();
    }

    function patchBootstrapSource(bootstrapSource, wasmUrl) {
        if (bootstrapSource.includes(BOOTSTRAP_PATTERN)) {
            return bootstrapSource.replace(BOOTSTRAP_PATTERN, `a='${wasmUrl}'`);
        }

        const fallbackPattern = /a=decodeURIComponent\(e\[0\]\|\|location\.origin\+location\.pathname\.replace\(\/\\\.js\$\/i,"\.wasm"\)\)/;
        if (fallbackPattern.test(bootstrapSource)) {
            return bootstrapSource.replace(fallbackPattern, `a='${wasmUrl}'`);
        }

        throw new Error('Unexpected Stockfish bootstrap format; unable to patch WASM URL.');
    }

    async function buildWorkerURL(scriptURL, wasmURL) {
        const response = await fetch(scriptURL);
        if (!response.ok) {
            throw new Error(`Unable to download Stockfish script (${response.status}) from ${scriptURL}`);
        }

        const bootstrapSource = await response.text();
        const patchedSource = patchBootstrapSource(bootstrapSource, wasmURL);
        const prelude = `
self.Module = self.Module || {};
self.Module.locateFile = self.Module.locateFile || function(path) {
    return path && path.endsWith('.wasm') ? '${wasmURL}' : path;
};
`;

        const blob = new Blob([prelude, patchedSource], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    }

    function ensureStockfishWorkerURL() {
        if (runtime.stockfishWorkerURLPromise) {
            return runtime.stockfishWorkerURLPromise;
        }

        runtime.stockfishWorkerURLPromise = (async () => {
            let lastError = null;

            for (let i = 0; i < config.STOCKFISH_SCRIPT_SOURCES.length; i++) {
                const scriptURL = config.STOCKFISH_SCRIPT_SOURCES[i];
                const wasmURL = config.STOCKFISH_WASM_SOURCES[i] || config.STOCKFISH_WASM_SOURCES[0];

                try {
                    return await buildWorkerURL(scriptURL, wasmURL);
                } catch (error) {
                    lastError = error;
                    ChessBot.logger.warn(`Stockfish source failed: ${scriptURL}`, error);
                }
            }

            runtime.stockfishWorkerURLPromise = null;
            throw lastError || new Error('Unable to fetch any Stockfish source.');
        })();

        return runtime.stockfishWorkerURLPromise;
    }

    function parseBestMove(message) {
        const match = message.match(/\bbestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/i);
        return match ? match[1].toLowerCase() : null;
    }

    function parser(event) {
        const message = typeof event.data === 'string' ? event.data : '';

        if (message.startsWith('info ')) {
            handleEngineInfoLine(message);
            return;
        }

        if (!message.includes('bestmove')) {
            return;
        }

        const moveToken = parseBestMove(message);
        const shouldApplyMoveHint = !myVars.evalOnly
            && runtime.extensionEnabled
            && searchContext.isPlayerTurn === true
            && searchContext.suppressMoveHint !== true;

        if (moveToken && shouldApplyMoveHint && typeof myFunctions.color === 'function') {
            myFunctions.color(moveToken);
        }

        searchContext.suppressMoveHint = false;
        runtime.isThinking = false;
        ChessBot.evalBar.updateEvaluationBarDisplay();
    }

    function spawnStockfishEngine(url) {
        engine.engine = new Worker(url);
        engine.engine.onmessage = parser;
        engine.engine.onerror = event => {
            ChessBot.logger.error('Worker error', event);
        };

        engine.engine.postMessage('setoption name Threads value 1');
        engine.engine.postMessage('ucinewgame');
        ChessBot.logger.info('Stockfish engine loaded');
    }

    function stopSf() {
        if (engine.engine) {
            try {
                engine.engine.postMessage('stop');
            } catch (error) {
                ChessBot.logger.warn('Failed to stop Stockfish engine', error);
            }
        }

        runtime.isThinking = false;
        ChessBot.evalBar.resetEvaluationState();
        ChessBot.evalBar.updateEvaluationBarDisplay();
        document.querySelectorAll('.highlight[data-test-element="highlight"]').forEach(node => node.remove());
    }

    function reloadChessEngine() {
        if (engine.engine) {
            engine.engine.terminate();
            engine.engine = null;
        }

        if (runtime.stockfishObjectURL) {
            URL.revokeObjectURL(runtime.stockfishObjectURL);
            runtime.stockfishObjectURL = null;
        }

        runtime.stockfishWorkerURLPromise = null;
        runtime.isThinking = false;
        ChessBot.evalBar.resetEvaluationState();
        loadChessEngine();
    }

    function loadChessEngine() {
        if (engine.engine) {
            return;
        }

        ensureStockfishWorkerURL()
            .then(url => {
                if (engine.engine) {
                    return;
                }
                runtime.stockfishObjectURL = url;
                spawnStockfishEngine(url);
            })
            .catch(error => {
                ChessBot.logger.error('Failed to initialise Stockfish engine', error);
            });
    }

    function runChessEngine(depth, options = {}) {
        if (!runtime.extensionEnabled) {
            return false;
        }

        if (!engine.engine || typeof engine.engine.postMessage !== 'function') {
            ChessBot.logger.warn('Stockfish engine is not ready yet.');
            return false;
        }

        const fen = ChessBot.dom.resolveCurrentFen();
        if (!fen) {
            ChessBot.logger.warn('No FEN available to send to Stockfish.');
            return false;
        }

        myVars.lastAnalyzedFen = fen;
        engine.engine.postMessage(`position fen ${fen}`);
        runtime.isThinking = true;
        engine.engine.postMessage(`go depth ${depth}`);
        runtime.lastValue = depth;

        const fenTokens = fen.split(/\s+/);
        const sideToMove = fenTokens[1] || 'w';
        searchContext.sideToMove = sideToMove;

        const playingAs = ChessBot.timing.normalizePlayingAsColor(myVars.playingAs) || ChessBot.timing.getPlayerColor();
        const isWhiteToMove = sideToMove === 'w';
        searchContext.isPlayerTurn = playingAs === 'white' ? isWhiteToMove : !isWhiteToMove;
        searchContext.suppressMoveHint = options.suppressHints === true;

        ChessBot.evalBar.updateEvaluationBarDisplay();
        return true;
    }

    ChessBot.engine = {
        ensureStockfishWorkerURL,
        stopSf,
        reloadChessEngine,
        loadChessEngine,
        runChessEngine,
        handleEngineInfoLine
    };
})();
