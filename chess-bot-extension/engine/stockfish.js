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
        searchContext,
        classifierRuntime,
        classification
    } = ChessBot.state;

    const BOOTSTRAP_PATTERN = 'a=decodeURIComponent(e[0]||location.origin+location.pathname.replace(/\\.js$/i,".wasm"))';
    const CLASSIFICATION_DEPTH_CAP = 14;
    const CLASSIFICATION_TIMEOUT_MS = 12000;
    const CLASSIFICATION_EPS = 1e-4;
    const CLASSIFIER_THREADS = 4;
    const BEST_CACHE_MAX_ENTRIES = 96;

    const bestSnapshotCache = new Map();
    const precomputeRuntime = {
        key: null,
        promise: null
    };
    const mainEngineBest = {
        fen: null,
        requestedDepth: 0,
        snapshot: null,
        bestMove: null,
        finalized: false,
        active: false
    };

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

    function createCancelledError(message = 'cancelled') {
        const error = new Error(message);
        error.code = 'CLASSIFIER_CANCELLED';
        return error;
    }

    function normalizeClassificationDepth(depthCap) {
        return Math.max(1, Math.min(CLASSIFICATION_DEPTH_CAP, Math.floor(depthCap) || CLASSIFICATION_DEPTH_CAP));
    }

    function clearClassifierPending(reason = 'cancelled') {
        if (!classifierRuntime.pending) {
            return;
        }

        const { reject, timeoutId } = classifierRuntime.pending;
        classifierRuntime.pending = null;
        clearTimeout(timeoutId);
        reject(createCancelledError(reason));
    }

    function resetClassifierWorker(reason = 'reset') {
        clearClassifierPending(reason);

        if (classifierRuntime.worker) {
            try {
                classifierRuntime.worker.terminate();
            } catch (error) {
                ChessBot.logger.debug('Unable to terminate classifier worker cleanly', error);
            }
        }

        classifierRuntime.worker = null;
    }

    function interruptClassifierWorker(reason = 'interrupted') {
        clearClassifierPending(reason);
        if (!classifierRuntime.worker || typeof classifierRuntime.worker.postMessage !== 'function') {
            return;
        }
        try {
            classifierRuntime.worker.postMessage('stop');
        } catch (error) {
            ChessBot.logger.debug('Unable to interrupt classifier worker cleanly', error);
        }
    }

    function updateClassifierSnapshot(message, snapshot) {
        if (typeof message !== 'string' || !message.startsWith('info ')) {
            return;
        }

        const multiPvMatch = message.match(/\bmultipv\s+(\d+)/);
        if (multiPvMatch && parseInt(multiPvMatch[1], 10) !== 1) {
            return;
        }

        const depthMatch = message.match(/\bdepth\s+(\d+)/);
        const depthValue = depthMatch ? parseInt(depthMatch[1], 10) : snapshot.depth;
        const shouldUpdate = !Number.isFinite(snapshot.depth) || depthValue >= snapshot.depth || snapshot.scoreType === null;

        let scoreType = null;
        let scoreValue = null;
        const mateMatch = message.match(/\bscore\s+mate\s+(-?\d+)/);
        if (mateMatch) {
            scoreType = 'mate';
            scoreValue = parseInt(mateMatch[1], 10);
        } else {
            const cpMatch = message.match(/\bscore\s+cp\s+(-?\d+)/);
            if (cpMatch) {
                scoreType = 'cp';
                scoreValue = parseInt(cpMatch[1], 10);
            }
        }

        if (shouldUpdate && scoreType !== null && Number.isFinite(scoreValue)) {
            snapshot.scoreType = scoreType;
            snapshot.scoreValue = scoreValue;
            snapshot.depth = depthValue;
        } else if (Number.isFinite(depthValue) && depthValue > snapshot.depth) {
            snapshot.depth = depthValue;
        }

        const wdlMatch = message.match(/\bwdl\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
        if (wdlMatch && shouldUpdate) {
            const w = parseInt(wdlMatch[1], 10);
            const d = parseInt(wdlMatch[2], 10);
            const l = parseInt(wdlMatch[3], 10);
            if (Number.isFinite(w) && Number.isFinite(d) && Number.isFinite(l)) {
                snapshot.wdl = { w, d, l };
                snapshot.depth = depthValue;
            }
        }
    }

    function clamp01(value) {
        return Math.max(0, Math.min(1, value));
    }

    function cloneSnapshot(snapshot) {
        if (!snapshot) {
            return null;
        }
        return {
            bestMove: typeof snapshot.bestMove === 'string' ? snapshot.bestMove : null,
            scoreType: typeof snapshot.scoreType === 'string' ? snapshot.scoreType : null,
            scoreValue: Number.isFinite(snapshot.scoreValue) ? snapshot.scoreValue : null,
            depth: Number.isFinite(snapshot.depth) ? snapshot.depth : -1,
            wdl: snapshot.wdl && Number.isFinite(snapshot.wdl.w) && Number.isFinite(snapshot.wdl.d) && Number.isFinite(snapshot.wdl.l)
                ? { w: snapshot.wdl.w, d: snapshot.wdl.d, l: snapshot.wdl.l }
                : null
        };
    }

    function hasUsableWdl(snapshot, minDepth = 1) {
        if (!snapshot || !Number.isFinite(snapshot.depth) || snapshot.depth < minDepth) {
            return false;
        }
        return !!(snapshot.wdl
            && Number.isFinite(snapshot.wdl.w)
            && Number.isFinite(snapshot.wdl.d)
            && Number.isFinite(snapshot.wdl.l));
    }

    function hasTrustedUciMove(move) {
        return typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move);
    }

    function makeBestSnapshotCacheKey(fen, depth) {
        return `${fen}::${depth}`;
    }

    function trimBestSnapshotCache() {
        while (bestSnapshotCache.size > BEST_CACHE_MAX_ENTRIES) {
            const oldestKey = bestSnapshotCache.keys().next().value;
            if (!oldestKey) {
                break;
            }
            bestSnapshotCache.delete(oldestKey);
        }
    }

    function readBestSnapshotCacheEntry(fen, depth) {
        if (typeof fen !== 'string' || !fen.trim()) {
            return null;
        }
        const safeDepth = normalizeClassificationDepth(depth);
        const key = makeBestSnapshotCacheKey(fen.trim(), safeDepth);
        return bestSnapshotCache.get(key) || null;
    }

    function canReuseBestSnapshot(snapshotMeta, fen, depth) {
        if (!snapshotMeta || typeof fen !== 'string' || !fen.trim()) {
            return false;
        }

        const normalizedFen = fen.trim();
        const safeDepth = normalizeClassificationDepth(depth);
        if (snapshotMeta.fen !== normalizedFen) {
            return false;
        }
        if (!snapshotMeta.hasWdl || snapshotMeta.depth < safeDepth) {
            return false;
        }
        if (!hasUsableWdl(snapshotMeta.snapshot, safeDepth)) {
            return false;
        }
        if (snapshotMeta.source === 'main-engine' && snapshotMeta.finalized !== true) {
            return false;
        }
        return true;
    }

    function writeBestSnapshotCache(fen, depth, snapshot, options = {}) {
        if (typeof fen !== 'string' || !fen.trim()) {
            return;
        }

        const safeDepth = normalizeClassificationDepth(depth);
        if (!hasUsableWdl(snapshot, safeDepth)) {
            return;
        }

        const normalizedFen = fen.trim();
        const normalizedSnapshot = cloneSnapshot(snapshot);
        const entry = {
            fen: normalizedFen,
            source: options.source || 'classifier',
            depth: Number.isFinite(normalizedSnapshot.depth) ? normalizedSnapshot.depth : safeDepth,
            hasWdl: true,
            finalized: options.finalized === true,
            cachedAt: Date.now(),
            snapshot: normalizedSnapshot
        };
        const key = makeBestSnapshotCacheKey(normalizedFen, safeDepth);
        bestSnapshotCache.delete(key);
        bestSnapshotCache.set(key, entry);
        trimBestSnapshotCache();
    }

    function resetMainEngineBest() {
        mainEngineBest.fen = null;
        mainEngineBest.requestedDepth = 0;
        mainEngineBest.snapshot = null;
        mainEngineBest.bestMove = null;
        mainEngineBest.finalized = false;
        mainEngineBest.active = false;
    }

    function beginMainEngineBestTracking(fen, depth) {
        if (typeof fen !== 'string' || !fen.trim()) {
            resetMainEngineBest();
            return;
        }

        mainEngineBest.fen = fen.trim();
        mainEngineBest.requestedDepth = Math.max(1, Math.floor(depth) || 1);
        mainEngineBest.snapshot = {
            bestMove: null,
            scoreType: null,
            scoreValue: null,
            depth: -1,
            wdl: null
        };
        mainEngineBest.bestMove = null;
        mainEngineBest.finalized = false;
        mainEngineBest.active = true;
    }

    function buildMainEngineSnapshotEntry(fen) {
        if (typeof fen !== 'string' || !fen.trim()) {
            return null;
        }
        if (mainEngineBest.fen !== fen.trim() || !mainEngineBest.snapshot) {
            return null;
        }

        const snapshot = cloneSnapshot(mainEngineBest.snapshot);
        if (hasTrustedUciMove(mainEngineBest.bestMove)) {
            snapshot.bestMove = mainEngineBest.bestMove;
        }

        return {
            fen: mainEngineBest.fen,
            source: 'main-engine',
            depth: Number.isFinite(snapshot.depth) ? snapshot.depth : -1,
            hasWdl: hasUsableWdl(snapshot, 1),
            finalized: mainEngineBest.finalized === true,
            cachedAt: Date.now(),
            snapshot
        };
    }

    function resolveBestSnapshotForFenDepth(fen, depth) {
        if (typeof fen !== 'string' || !fen.trim()) {
            return null;
        }

        const normalizedFen = fen.trim();
        const safeDepth = normalizeClassificationDepth(depth);
        const cachedEntry = readBestSnapshotCacheEntry(normalizedFen, safeDepth);
        if (canReuseBestSnapshot(cachedEntry, normalizedFen, safeDepth)) {
            ChessBot.logger.debug('Move classification best snapshot cache hit', {
                source: cachedEntry.source,
                depth: safeDepth
            });
            return {
                snapshot: cloneSnapshot(cachedEntry.snapshot),
                source: cachedEntry.source,
                trustedBestMove: cachedEntry.source === 'classifier' || cachedEntry.source === 'precompute'
            };
        }

        const mainEntry = buildMainEngineSnapshotEntry(normalizedFen);
        if (canReuseBestSnapshot(mainEntry, normalizedFen, safeDepth)) {
            writeBestSnapshotCache(normalizedFen, safeDepth, mainEntry.snapshot, {
                source: 'main-engine',
                finalized: true
            });
            ChessBot.logger.debug('Move classification best snapshot reused from main engine', {
                depth: safeDepth
            });
            return {
                snapshot: cloneSnapshot(mainEntry.snapshot),
                source: 'main-engine',
                trustedBestMove: false
            };
        }

        ChessBot.logger.debug('Move classification best snapshot cache miss', {
            depth: safeDepth
        });
        return null;
    }

    function finalizeMainEngineBest(bestMove) {
        if (!mainEngineBest.fen || !mainEngineBest.snapshot) {
            return;
        }

        if (hasTrustedUciMove(bestMove)) {
            mainEngineBest.bestMove = bestMove.toLowerCase();
            mainEngineBest.snapshot.bestMove = mainEngineBest.bestMove;
        }

        mainEngineBest.finalized = true;
        mainEngineBest.active = false;
        const safeDepth = normalizeClassificationDepth(mainEngineBest.requestedDepth);
        const candidateEntry = buildMainEngineSnapshotEntry(mainEngineBest.fen);
        if (!canReuseBestSnapshot(candidateEntry, mainEngineBest.fen, safeDepth)) {
            return;
        }

        writeBestSnapshotCache(mainEngineBest.fen, safeDepth, candidateEntry.snapshot, {
            source: 'main-engine',
            finalized: true
        });
    }

    function expectedPointsFromAnalysis(snapshot) {
        if (snapshot && snapshot.wdl) {
            const { w, d, l } = snapshot.wdl;
            const total = w + d + l;
            if (Number.isFinite(total) && total > 0) {
                return clamp01((w + d * 0.5) / total);
            }
            return clamp01((w + d * 0.5) / 1000);
        }

        const normalizedScore = normalizeEngineScore(snapshot ? snapshot.scoreType : null, snapshot ? snapshot.scoreValue : null);
        if (!Number.isFinite(normalizedScore)) {
            return 0.5;
        }

        const clamped = ChessBot.timing.clamp(normalizedScore, -2000, 2000);
        const evalPawns = clamped / 100;
        const adjustedEval = Math.sign(evalPawns) * Math.pow(Math.abs(evalPawns), 0.85);
        return clamp01(0.5 + 0.5 * Math.tanh(adjustedEval / 4));
    }

    function classifyByExpectedPointsLoss(epl) {
        if (!Number.isFinite(epl) || epl < 0) {
            return null;
        }
        if (epl <= CLASSIFICATION_EPS) {
            return 'best';
        }
        if (epl <= 0.02) {
            return 'excellent';
        }
        if (epl <= 0.05) {
            return 'good';
        }
        if (epl <= 0.10) {
            return 'inaccuracy';
        }
        if (epl <= 0.20) {
            return 'mistake';
        }
        return 'blunder';
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

        if (mainEngineBest.active && runtime.isThinking && mainEngineBest.snapshot) {
            updateClassifierSnapshot(message, mainEngineBest.snapshot);
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

    function handleClassifierMessage(event) {
        const message = typeof event.data === 'string' ? event.data : '';
        const pending = classifierRuntime.pending;
        if (!pending) {
            return;
        }

        if (message.startsWith('info ')) {
            updateClassifierSnapshot(message, pending.snapshot);
            return;
        }

        if (!message.includes('bestmove')) {
            return;
        }

        const bestMove = parseBestMove(message);
        classifierRuntime.pending = null;
        clearTimeout(pending.timeoutId);
        pending.resolve({
            bestMove,
            scoreType: pending.snapshot.scoreType,
            scoreValue: pending.snapshot.scoreValue,
            depth: pending.snapshot.depth,
            wdl: pending.snapshot.wdl
        });
    }

    async function ensureClassifierWorker(forceRestart = false) {
        if (forceRestart) {
            resetClassifierWorker('restart');
        }

        if (classifierRuntime.worker) {
            return classifierRuntime.worker;
        }

        const url = await ensureStockfishWorkerURL();
        const worker = new Worker(url);
        worker.onmessage = handleClassifierMessage;
        worker.onerror = event => {
            ChessBot.logger.warn('Classifier worker error', event);
            resetClassifierWorker('worker-error');
        };

        worker.postMessage(`setoption name Threads value ${CLASSIFIER_THREADS}`);
        worker.postMessage('setoption name MultiPV value 1');
        worker.postMessage('setoption name UCI_ShowWDL value true');
        worker.postMessage('ucinewgame');
        classifierRuntime.worker = worker;
        return worker;
    }

    function runClassifierAnalysis(worker, options) {
        const {
            fen,
            depth,
            searchMoves,
            replacePending = true
        } = options || {};

        return new Promise((resolve, reject) => {
            if (!worker || typeof worker.postMessage !== 'function') {
                reject(new Error('Classifier worker is not ready.'));
                return;
            }

            if (typeof fen !== 'string' || fen.trim().length === 0) {
                reject(new Error('Classifier received empty FEN.'));
                return;
            }

            if (replacePending) {
                interruptClassifierWorker('replaced');
            } else if (classifierRuntime.pending) {
                reject(createCancelledError('worker-busy'));
                return;
            }

            const requestId = ++classifierRuntime.requestId;
            const safeDepth = normalizeClassificationDepth(depth || 1);
            const timeoutId = setTimeout(() => {
                if (!classifierRuntime.pending || classifierRuntime.pending.requestId !== requestId) {
                    return;
                }
                classifierRuntime.pending = null;
                reject(new Error('Classifier analysis timed out.'));
                try {
                    worker.postMessage('stop');
                } catch (error) {
                    ChessBot.logger.debug('Unable to stop classifier worker after timeout', error);
                }
            }, CLASSIFICATION_TIMEOUT_MS);

            classifierRuntime.pending = {
                requestId,
                resolve,
                reject,
                timeoutId,
                snapshot: {
                    scoreType: null,
                    scoreValue: null,
                    depth: -1,
                    wdl: null
                }
            };

            try {
                worker.postMessage('stop');
                worker.postMessage(`position fen ${fen}`);

                let command = `go depth ${safeDepth}`;
                if (Array.isArray(searchMoves) && searchMoves.length > 0) {
                    const normalizedMoves = searchMoves
                        .map(move => (typeof move === 'string' ? move.toLowerCase() : ''))
                        .filter(move => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
                    if (normalizedMoves.length > 0) {
                        command += ` searchmoves ${normalizedMoves.join(' ')}`;
                    }
                }

                worker.postMessage(command);
            } catch (error) {
                if (classifierRuntime.pending && classifierRuntime.pending.requestId === requestId) {
                    classifierRuntime.pending = null;
                    clearTimeout(timeoutId);
                }
                reject(error);
            }
        });
    }

    async function classifyMove({ fenBefore, playedUci, depthCap } = {}) {
        const fen = typeof fenBefore === 'string' ? fenBefore.trim() : '';
        const normalizedMove = typeof playedUci === 'string' ? playedUci.toLowerCase() : '';

        if (!fen) {
            throw new Error('Unable to classify move without FEN.');
        }
        if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(normalizedMove)) {
            throw new Error(`Invalid UCI move for classification: ${playedUci}`);
        }

        const jobId = classifierRuntime.inFlightJobId + 1;
        if (classification.inFlight && classifierRuntime.inFlightJobId !== 0) {
            interruptClassifierWorker('job-replaced');
        }
        classifierRuntime.inFlightJobId = jobId;
        classification.inFlight = true;

        const safeDepth = normalizeClassificationDepth(depthCap);

        try {
            const worker = await ensureClassifierWorker();
            if (classifierRuntime.inFlightJobId !== jobId) {
                throw createCancelledError('stale-job');
            }

            const bestResolution = resolveBestSnapshotForFenDepth(fen, safeDepth);
            let bestSnapshot = bestResolution ? bestResolution.snapshot : null;
            let bestSource = bestResolution ? bestResolution.source : 'classifier';
            let trustedBestMove = !!(bestResolution && bestResolution.trustedBestMove === true);

            if (!bestSnapshot) {
                bestSnapshot = await runClassifierAnalysis(worker, {
                    fen,
                    depth: safeDepth
                });
                writeBestSnapshotCache(fen, safeDepth, bestSnapshot, {
                    source: 'classifier',
                    finalized: true
                });
                trustedBestMove = true;
                bestSource = 'classifier';
            }

            if (classifierRuntime.inFlightJobId !== jobId) {
                throw createCancelledError('stale-job');
            }

            const trustedBestMoveMatch = trustedBestMove
                && hasTrustedUciMove(bestSnapshot.bestMove)
                && bestSnapshot.bestMove === normalizedMove;

            let playedSnapshot = bestSnapshot;
            if (!trustedBestMoveMatch) {
                playedSnapshot = await runClassifierAnalysis(worker, {
                    fen,
                    depth: safeDepth,
                    searchMoves: [normalizedMove]
                });
            } else {
                ChessBot.logger.debug('Move classification played pass skipped', {
                    reason: 'trusted-bestmove-match',
                    source: bestSource,
                    depth: safeDepth
                });
            }

            if (classifierRuntime.inFlightJobId !== jobId) {
                throw createCancelledError('stale-job');
            }

            const epBest = expectedPointsFromAnalysis(bestSnapshot);
            const epPlayed = expectedPointsFromAnalysis(playedSnapshot);
            const epl = Math.max(0, epBest - epPlayed);
            const label = classifyByExpectedPointsLoss(epl);

            return {
                epBest,
                epPlayed,
                epl,
                label,
                depth: safeDepth,
                bestMove: bestSnapshot.bestMove,
                playedMove: normalizedMove,
                bestSource
            };
        } finally {
            if (classifierRuntime.inFlightJobId === jobId) {
                classification.inFlight = false;
            }
        }
    }

    async function precomputeBestSnapshot({ fen, depthCap } = {}) {
        const normalizedFen = typeof fen === 'string' ? fen.trim() : '';
        if (!normalizedFen) {
            return false;
        }

        const safeDepth = normalizeClassificationDepth(depthCap);
        if (resolveBestSnapshotForFenDepth(normalizedFen, safeDepth)) {
            ChessBot.logger.debug('Move classification precompute skipped', {
                reason: 'cache-hit',
                depth: safeDepth
            });
            return true;
        }

        const key = makeBestSnapshotCacheKey(normalizedFen, safeDepth);
        if (precomputeRuntime.promise && precomputeRuntime.key === key) {
            ChessBot.logger.debug('Move classification precompute skipped', {
                reason: 'dedupe',
                depth: safeDepth
            });
            return false;
        }
        if (classification.inFlight || classifierRuntime.pending) {
            ChessBot.logger.debug('Move classification precompute skipped', {
                reason: 'busy',
                depth: safeDepth
            });
            return false;
        }

        const promise = (async () => {
            try {
                if (resolveBestSnapshotForFenDepth(normalizedFen, safeDepth)) {
                    ChessBot.logger.debug('Move classification precompute skipped', {
                        reason: 'cache-hit',
                        depth: safeDepth
                    });
                    return true;
                }
                if (classification.inFlight || classifierRuntime.pending) {
                    ChessBot.logger.debug('Move classification precompute skipped', {
                        reason: 'busy',
                        depth: safeDepth
                    });
                    return false;
                }

                const worker = await ensureClassifierWorker();
                if (classification.inFlight || classifierRuntime.pending) {
                    ChessBot.logger.debug('Move classification precompute skipped', {
                        reason: 'busy',
                        depth: safeDepth
                    });
                    return false;
                }

                const bestSnapshot = await runClassifierAnalysis(worker, {
                    fen: normalizedFen,
                    depth: safeDepth,
                    replacePending: false
                });
                writeBestSnapshotCache(normalizedFen, safeDepth, bestSnapshot, {
                    source: 'precompute',
                    finalized: true
                });
                return true;
            } catch (error) {
                if (!error || error.code !== 'CLASSIFIER_CANCELLED') {
                    ChessBot.logger.debug('Best snapshot precompute failed', error);
                }
                return false;
            } finally {
                if (precomputeRuntime.key === key) {
                    precomputeRuntime.key = null;
                    precomputeRuntime.promise = null;
                }
            }
        })();

        precomputeRuntime.key = key;
        precomputeRuntime.promise = promise;
        return promise;
    }

    function resetClassifier() {
        classifierRuntime.inFlightJobId += 1;
        classification.inFlight = false;
        bestSnapshotCache.clear();
        precomputeRuntime.key = null;
        precomputeRuntime.promise = null;
        resetMainEngineBest();
        resetClassifierWorker('reset');
    }

    function reloadClassifier() {
        resetClassifier();
    }

    async function prepareClassifier() {
        try {
            await ensureClassifierWorker();
            return true;
        } catch (error) {
            ChessBot.logger.debug('Unable to prewarm classifier worker', error);
            return false;
        }
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
        finalizeMainEngineBest(moveToken);
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

        resetClassifier();

        runtime.isThinking = false;
        ChessBot.evalBar.resetEvaluationState();
        ChessBot.evalBar.updateEvaluationBarDisplay();
        document.querySelectorAll('.highlight[data-test-element="highlight"]').forEach(node => node.remove());
    }

    function reloadChessEngine() {
        reloadClassifier();

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

        const gameOverModalVisible = typeof ChessBot.dom.isGameOverModalVisible === 'function'
            ? ChessBot.dom.isGameOverModalVisible()
            : false;
        if (gameOverModalVisible) {
            runtime.gameOverModalSeen = true;
            runtime.gameOverLockedFen = fen;
            runtime.isInActiveGame = false;
            ChessBot.logger.debug('Skip engine run: game over modal is visible');
            return false;
        }

        if (runtime.gameOverLockedFen) {
            if (fen === runtime.gameOverLockedFen) {
                runtime.isInActiveGame = false;
                ChessBot.logger.debug('Skip engine run: waiting for new game FEN after game over');
                return false;
            }
            runtime.gameOverLockedFen = null;
            runtime.gameOverModalSeen = false;
        }

        myVars.lastAnalyzedFen = fen;
        beginMainEngineBestTracking(fen, depth);
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

    ChessBot.classifier = {
        classifyMove,
        precomputeBest: precomputeBestSnapshot,
        prepare: prepareClassifier,
        reset: resetClassifier,
        reload: reloadClassifier
    };
})();
