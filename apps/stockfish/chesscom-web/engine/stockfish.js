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
    const CLASSIFICATION_POLICY = Object.freeze({
        eps: 1e-4,
        depthCap: 14,
        cpFloorInSaturation: Object.freeze({
            enabled: true,
            lowEpBound: 0.15,
            highEpBound: 0.85,
            thresholds: Object.freeze([
                Object.freeze({ label: 'blunder', minCpLoss: 220 }),
                Object.freeze({ label: 'mistake', minCpLoss: 120 }),
                Object.freeze({ label: 'inaccuracy', minCpLoss: 60 })
            ])
        }),
        thresholds: Object.freeze([
            Object.freeze({ label: 'excellent', max: 0.02 }),
            Object.freeze({ label: 'good', max: 0.05 }),
            Object.freeze({ label: 'inaccuracy', max: 0.10 }),
            Object.freeze({ label: 'mistake', max: 0.20 })
        ])
    });
    const CLASSIFICATION_LABEL_RANK = Object.freeze({
        best: 0,
        excellent: 1,
        good: 2,
        inaccuracy: 3,
        mistake: 4,
        blunder: 5
    });
    const CLASSIFICATION_TIMEOUT_MS = 12000;
    const CLASSIFIER_OPTIONS = Object.freeze({
        threads: 4,
        multiPv: 1,
        uciShowWdl: true
    });
    const BEST_CACHE_MAX_ENTRIES = 96;
    const bestSnapshotCache = new Map();
    const precomputeRuntime = {
        key: null,
        promise: null
    };

    function resolveClassifierScriptSourceToken() {
        const runtimeSource = typeof runtime.stockfishResolvedScriptURL === 'string'
            ? runtime.stockfishResolvedScriptURL.trim()
            : '';
        if (runtimeSource) {
            return runtimeSource.split('?')[0];
        }

        const configuredSource = Array.isArray(config.STOCKFISH_SCRIPT_SOURCES)
            ? (config.STOCKFISH_SCRIPT_SOURCES[0] || '')
            : '';
        return typeof configuredSource === 'string' && configuredSource.trim()
            ? configuredSource.trim().split('?')[0]
            : 'unknown-engine';
    }

    function getClassifierProfileKey() {
        return `${CLASSIFIER_OPTIONS.threads}|${CLASSIFIER_OPTIONS.multiPv}|${CLASSIFIER_OPTIONS.uciShowWdl ? 'wdl1' : 'wdl0'}|${resolveClassifierScriptSourceToken()}`;
    }

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
        return Math.max(1, Math.min(CLASSIFICATION_POLICY.depthCap, Math.floor(depthCap) || CLASSIFICATION_POLICY.depthCap));
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
            if (isValidWdl({ w, d, l })) {
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

    function isValidWdl(wdl) {
        if (!wdl) {
            return false;
        }
        const { w, d, l } = wdl;
        if (!Number.isFinite(w) || !Number.isFinite(d) || !Number.isFinite(l)) {
            return false;
        }
        if (w < 0 || d < 0 || l < 0) {
            return false;
        }
        return (w + d + l) > 0;
    }

    function hasUsableWdl(snapshot, minDepth = 1) {
        if (!snapshot || !Number.isFinite(snapshot.depth) || snapshot.depth < minDepth) {
            return false;
        }
        return isValidWdl(snapshot.wdl);
    }

    function hasTrustedUciMove(move) {
        return typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move);
    }

    function makeBestSnapshotCacheKey(fen, depth, profileKey) {
        const effectiveProfileKey = typeof profileKey === 'string' && profileKey
            ? profileKey
            : getClassifierProfileKey();
        return `${fen}::${depth}::${effectiveProfileKey}`;
    }

    function getBestSnapshotCacheKey(fen, depthCap) {
        if (typeof fen !== 'string' || !fen.trim()) {
            return null;
        }
        const safeDepth = normalizeClassificationDepth(depthCap);
        return makeBestSnapshotCacheKey(fen.trim(), safeDepth, getClassifierProfileKey());
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

    function readBestSnapshotCacheEntry(fen, depth, profileKey) {
        if (typeof fen !== 'string' || !fen.trim()) {
            return null;
        }
        const safeDepth = normalizeClassificationDepth(depth);
        const key = makeBestSnapshotCacheKey(fen.trim(), safeDepth, profileKey);
        return bestSnapshotCache.get(key) || null;
    }

    function canReuseBestSnapshot(snapshotMeta, fen, depth, profileKey) {
        if (!snapshotMeta || typeof fen !== 'string' || !fen.trim()) {
            return false;
        }

        const normalizedFen = fen.trim();
        const safeDepth = normalizeClassificationDepth(depth);
        if (snapshotMeta.fen !== normalizedFen) {
            return false;
        }
        if (snapshotMeta.profileKey !== profileKey) {
            return false;
        }
        if (!snapshotMeta.hasWdl || snapshotMeta.depth < safeDepth) {
            return false;
        }
        if (!hasUsableWdl(snapshotMeta.snapshot, safeDepth)) {
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

        const profileKey = typeof options.profileKey === 'string' && options.profileKey
            ? options.profileKey
            : getClassifierProfileKey();
        const normalizedFen = fen.trim();
        const normalizedSnapshot = cloneSnapshot(snapshot);
        const entry = {
            fen: normalizedFen,
            profileKey,
            source: options.source || 'classifier',
            depth: Number.isFinite(normalizedSnapshot.depth) ? normalizedSnapshot.depth : safeDepth,
            hasWdl: true,
            cachedAt: Date.now(),
            snapshot: normalizedSnapshot
        };
        const key = makeBestSnapshotCacheKey(normalizedFen, safeDepth, profileKey);
        bestSnapshotCache.delete(key);
        bestSnapshotCache.set(key, entry);
        trimBestSnapshotCache();
    }

    function incrementClassificationCounter(counterName) {
        if (!classification || typeof counterName !== 'string' || !counterName) {
            return;
        }
        const currentValue = Number.isFinite(classification[counterName]) ? classification[counterName] : 0;
        classification[counterName] = currentValue + 1;
    }

    function resolveBestSnapshotForFenDepth(fen, depth, profileKey) {
        if (typeof fen !== 'string' || !fen.trim()) {
            return null;
        }

        const normalizedFen = fen.trim();
        const safeDepth = normalizeClassificationDepth(depth);
        const effectiveProfileKey = typeof profileKey === 'string' && profileKey
            ? profileKey
            : getClassifierProfileKey();
        const cachedEntry = readBestSnapshotCacheEntry(normalizedFen, safeDepth, effectiveProfileKey);
        if (canReuseBestSnapshot(cachedEntry, normalizedFen, safeDepth, effectiveProfileKey)) {
            ChessBot.logger.debug('Move classification best snapshot cache hit', {
                source: cachedEntry.source,
                depth: safeDepth,
                profileKey: effectiveProfileKey
            });
            return {
                snapshot: cloneSnapshot(cachedEntry.snapshot),
                source: cachedEntry.source,
                trustedBestMove: cachedEntry.source === 'classifier' || cachedEntry.source === 'precompute'
            };
        }

        ChessBot.logger.debug('Move classification best snapshot cache miss', {
            depth: safeDepth,
            profileKey: effectiveProfileKey
        });
        return null;
    }

    function expectedPointsFromAnalysis(snapshot) {
        if (snapshot && isValidWdl(snapshot.wdl)) {
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
        if (epl <= CLASSIFICATION_POLICY.eps) {
            return 'best';
        }
        for (const threshold of CLASSIFICATION_POLICY.thresholds) {
            if (epl <= threshold.max) {
                return threshold.label;
            }
        }
        return 'blunder';
    }

    function classifyByCpLoss(cpLoss) {
        if (!Number.isFinite(cpLoss) || cpLoss < 0) {
            return null;
        }
        for (const threshold of CLASSIFICATION_POLICY.cpFloorInSaturation.thresholds) {
            if (cpLoss >= threshold.minCpLoss) {
                return threshold.label;
            }
        }
        return null;
    }

    function shouldApplyCpFloor(epBest) {
        if (!CLASSIFICATION_POLICY.cpFloorInSaturation.enabled || !Number.isFinite(epBest)) {
            return false;
        }
        const { lowEpBound, highEpBound } = CLASSIFICATION_POLICY.cpFloorInSaturation;
        return epBest <= lowEpBound || epBest >= highEpBound;
    }

    function chooseWorseLabel(baseLabel, floorLabel) {
        if (!baseLabel) {
            return floorLabel || null;
        }
        if (!floorLabel) {
            return baseLabel;
        }
        const baseRank = CLASSIFICATION_LABEL_RANK[baseLabel];
        const floorRank = CLASSIFICATION_LABEL_RANK[floorLabel];
        if (!Number.isFinite(baseRank)) {
            return floorLabel;
        }
        if (!Number.isFinite(floorRank)) {
            return baseLabel;
        }
        return floorRank > baseRank ? floorLabel : baseLabel;
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
                    const workerUrl = await buildWorkerURL(scriptURL, wasmURL);
                    runtime.stockfishResolvedScriptURL = scriptURL;
                    runtime.stockfishResolvedWasmURL = wasmURL;
                    return workerUrl;
                } catch (error) {
                    lastError = error;
                    ChessBot.logger.warn(`Stockfish source failed: ${scriptURL}`, error);
                }
            }

            runtime.stockfishWorkerURLPromise = null;
            runtime.stockfishResolvedScriptURL = null;
            runtime.stockfishResolvedWasmURL = null;
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

        worker.postMessage(`setoption name Threads value ${CLASSIFIER_OPTIONS.threads}`);
        worker.postMessage(`setoption name MultiPV value ${CLASSIFIER_OPTIONS.multiPv}`);
        worker.postMessage(`setoption name UCI_ShowWDL value ${CLASSIFIER_OPTIONS.uciShowWdl ? 'true' : 'false'}`);
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

            const profileKey = getClassifierProfileKey();
            const bestResolution = resolveBestSnapshotForFenDepth(fen, safeDepth, profileKey);
            if (bestResolution) {
                incrementClassificationCounter('cacheHitCount');
            } else {
                incrementClassificationCounter('cacheMissCount');
            }
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
                    profileKey
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
            const bestScore = normalizeEngineScore(bestSnapshot.scoreType, bestSnapshot.scoreValue);
            const playedScore = normalizeEngineScore(playedSnapshot.scoreType, playedSnapshot.scoreValue);
            const cpLoss = Number.isFinite(bestScore) && Number.isFinite(playedScore)
                ? Math.max(0, bestScore - playedScore)
                : null;
            const rawDelta = epBest - epPlayed;
            if (rawDelta < 0) {
                incrementClassificationCounter('negativeDeltaCount');
                ChessBot.logger.debug('Move classification negative raw delta detected', {
                    rawDelta,
                    depth: safeDepth,
                    bestSource
                });
            }
            const epl = Math.max(0, rawDelta);
            const epLabel = classifyByExpectedPointsLoss(epl);
            const cpFloorLabel = shouldApplyCpFloor(epBest) ? classifyByCpLoss(cpLoss) : null;
            const label = chooseWorseLabel(epLabel, cpFloorLabel);
            if (cpFloorLabel && cpFloorLabel !== epLabel) {
                ChessBot.logger.debug('Move classification cp floor applied', {
                    epBest,
                    epl,
                    cpLoss,
                    epLabel,
                    cpFloorLabel,
                    finalLabel: label
                });
            }
            incrementClassificationCounter('classificationCount');

            return {
                epBest,
                epPlayed,
                cpLoss,
                epLabel,
                cpFloorLabel,
                rawDelta,
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
        const profileKey = getClassifierProfileKey();
        if (resolveBestSnapshotForFenDepth(normalizedFen, safeDepth, profileKey)) {
            ChessBot.logger.debug('Move classification precompute skipped', {
                reason: 'cache-hit',
                depth: safeDepth
            });
            return true;
        }

        const key = makeBestSnapshotCacheKey(normalizedFen, safeDepth, profileKey);
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
                if (resolveBestSnapshotForFenDepth(normalizedFen, safeDepth, profileKey)) {
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
                    profileKey
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
        runtime.stockfishResolvedScriptURL = null;
        runtime.stockfishResolvedWasmURL = null;
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
        getCacheKey: getBestSnapshotCacheKey,
        reset: resetClassifier,
        reload: reloadClassifier
    };
})();
