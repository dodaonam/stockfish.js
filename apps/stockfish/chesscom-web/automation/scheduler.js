(function() {
    'use strict';

    const ChessBot = window.ChessBot;
    const {
        config,
        runtime,
        myVars,
        myFunctions,
        evaluationState,
        engineMetrics,
        classification
    } = ChessBot.state;
    const PRECOMPUTE_MIN_INTERVAL_MS = 500;

    function delay(minS, maxS) {
        return new Promise(resolve => {
            const min = Math.min(minS, maxS);
            const max = Math.max(minS, maxS);
            const delayMs = (Math.random() * (max - min) + min) * 1000;
            setTimeout(resolve, delayMs);
        });
    }

    function waitForSeconds(seconds) {
        return new Promise(resolve => {
            const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
            setTimeout(resolve, safeSeconds * 1000);
        });
    }

    function convertSquareNotation(square) {
        const col = square.charAt(0);
        return (config.COL_TO_NUM[col] || col) + square.charAt(1);
    }

    function createSquareHighlight(square) {
        const node = document.createElement('div');
        node.className = `highlight square-${square} bro`;
        node.style.backgroundColor = config.HIGHLIGHT_COLOR;
        node.style.opacity = String(config.HIGHLIGHT_OPACITY);
        node.setAttribute('data-test-element', 'highlight');

        if (runtime.board && runtime.board.nodeName) {
            const boardSelector = runtime.board.nodeName.toLowerCase();
            const boardEl = document.querySelector(boardSelector);
            if (boardEl) {
                boardEl.prepend(node);
                setTimeout(() => node.remove(), config.HIGHLIGHT_DURATION_MS);
                return;
            }
        }

        node.remove();
    }

    function movePiece(from, to) {
        if (!runtime.board || !runtime.board.game || typeof runtime.board.game.getLegalMoves !== 'function') {
            return;
        }

        const legalMoves = runtime.board.game.getLegalMoves();
        const matchingMove = legalMoves.find(move => move.from === from && move.to === to);
        if (!matchingMove) {
            return;
        }

        runtime.board.game.move({
            ...matchingMove,
            promotion: 'false',
            animate: false,
            userGenerated: true
        });
    }

    function colorBestMove(moveData) {
        if (myVars.evalOnly || !moveData || moveData.length < 4) {
            return;
        }

        const fromSquare = moveData.substring(0, 2);
        const toSquare = moveData.substring(2, 4);

        if (myVars.autoMove) {
            movePiece(fromSquare, toSquare);
        }

        runtime.isThinking = false;
        createSquareHighlight(convertSquareNotation(toSquare));
        createSquareHighlight(convertSquareNotation(fromSquare));
    }

    function setChessBotEnabled(enabled) {
        runtime.extensionEnabled = enabled;

        const controlPanel = document.getElementById('sf-control-root') || document.getElementById('sf-ctrl-panel');
        if (controlPanel) {
            controlPanel.style.display = enabled ? '' : 'none';
            controlPanel.style.opacity = '1';
            controlPanel.style.pointerEvents = enabled ? 'auto' : 'none';
        }

        const evalRoot = document.getElementById('sf-eval-root');
        if (evalRoot) {
            evalRoot.style.display = ChessBot.evalBar.shouldShowEvaluationBar() ? '' : 'none';
        }

        if (!enabled && typeof ChessBot.engine.stopSf === 'function') {
            ChessBot.engine.stopSf();
            resetMoveClassificationState(true);
        } else if (enabled) {
            classification.lastFen = ChessBot.dom.resolveCurrentFen() || classification.lastFen;
        }
    }

    function resolvePlayingAsFromBoard(clocks) {
        const board = runtime.board;
        let detectedColor = null;

        if (board && board.game && typeof board.game.getPlayingAs === 'function') {
            detectedColor = ChessBot.timing.normalizePlayingAsColor(board.game.getPlayingAs());
            if (detectedColor) {
                myVars.playingAs = detectedColor;
            }

            if (typeof board.game.getFEN === 'function') {
                const fen = board.game.getFEN();
                if (fen) {
                    if (myVars.lastObservedFen && myVars.lastObservedFen !== config.STARTING_FEN && fen === config.STARTING_FEN) {
                        myVars.detectedTimeControl = null;
                        myVars.lastHumanDelaySec = null;
                        myVars.lastAnalyzedFen = null;
                        ChessBot.timing.resetTempoStats();
                        runtime.gameOverLockedFen = null;
                        runtime.gameOverModalSeen = false;
                        resetMoveClassificationState(false);
                    }
                    myVars.lastObservedFen = fen;
                }

                if (fen && fen !== config.STARTING_FEN) {
                    runtime.isInActiveGame = true;
                    runtime.confirmedPlayerColor = detectedColor || myVars.playingAs || runtime.confirmedPlayerColor;
                }
            }
        }

        const bottomClockColor = ChessBot.timing.normalizePlayingAsColor(clocks.bottom.color);
        const topClockColor = ChessBot.timing.normalizePlayingAsColor(clocks.top.color);
        const playingAs = ChessBot.timing.normalizePlayingAsColor(myVars.playingAs) || bottomClockColor || topClockColor || 'white';
        myVars.playingAs = playingAs;
        return playingAs;
    }

    function shouldAnalyzeCurrentTurn() {
        const autoRunCheckbox = document.getElementById('autoRun');
        return !!(autoRunCheckbox?.checked || myVars.evalOnly);
    }

    function shouldPauseForGameOver(currentFen) {
        const modalVisible = typeof ChessBot.dom.isGameOverModalVisible === 'function'
            ? ChessBot.dom.isGameOverModalVisible()
            : false;

        if (modalVisible) {
            if (!runtime.gameOverModalSeen && typeof ChessBot.engine.stopSf === 'function') {
                ChessBot.engine.stopSf();
                resetMoveClassificationState(false);
            }
            runtime.gameOverModalSeen = true;
            if (currentFen) {
                runtime.gameOverLockedFen = currentFen;
            }
            runtime.isInActiveGame = false;
            return true;
        }

        if (runtime.gameOverLockedFen) {
            if (!currentFen || currentFen === runtime.gameOverLockedFen) {
                runtime.isInActiveGame = false;
                return true;
            }
            runtime.gameOverLockedFen = null;
            runtime.gameOverModalSeen = false;
        }

        return false;
    }

    function shouldRunMoveClassification() {
        if (!runtime.extensionEnabled) {
            return false;
        }
        if (!(myVars.autoRun || myVars.evalOnly || myVars.autoMove)) {
            return false;
        }
        return ChessBot.dom.isLiveGameContext();
    }

    function clearMoveClassificationIcon() {
        if (ChessBot.ui && ChessBot.ui.moveClassificationOverlay && typeof ChessBot.ui.moveClassificationOverlay.clear === 'function') {
            ChessBot.ui.moveClassificationOverlay.clear();
        }
    }

    function resetMoveClassificationState(resetLastFen = false) {
        classification.enabled = false;
        classification.inFlight = false;
        classification.requestSeq += 1;
        classification.lastMoveKey = null;
        classification.precomputeLastKey = null;
        classification.precomputeLastAt = 0;
        if (resetLastFen) {
            classification.lastFen = null;
        }
        clearMoveClassificationIcon();
        if (ChessBot.classifier && typeof ChessBot.classifier.reset === 'function') {
            ChessBot.classifier.reset();
        }
    }

    function precomputeBestSnapshotForCurrentFen(currentFen) {
        if (!currentFen) {
            return;
        }
        if (!ChessBot.classifier || typeof ChessBot.classifier.precomputeBest !== 'function') {
            return;
        }
        if (runtime.isThinking || classification.inFlight) {
            return;
        }

        const depthCap = Math.max(1, Math.min(14, Math.floor(runtime.lastValue) || config.DEFAULT_DEPTH));
        const precomputeKey = (typeof ChessBot.classifier.getCacheKey === 'function')
            ? ChessBot.classifier.getCacheKey(currentFen, depthCap)
            : `${currentFen}::${depthCap}`;
        if (!precomputeKey) {
            return;
        }
        const now = Date.now();

        if (classification.precomputeLastKey === precomputeKey
            && (now - classification.precomputeLastAt) < PRECOMPUTE_MIN_INTERVAL_MS) {
            ChessBot.logger.debug('Move classification precompute skipped', {
                reason: 'debounced',
                key: precomputeKey
            });
            return;
        }

        classification.precomputeLastKey = precomputeKey;
        classification.precomputeLastAt = now;
        ChessBot.classifier.precomputeBest({
            fen: currentFen,
            depthCap
        });
    }

    function handleMoveClassificationTick(currentFen) {
        const classificationAllowed = shouldRunMoveClassification();
        if (!classificationAllowed) {
            if (classification.enabled || classification.activeIcon || classification.inFlight) {
                resetMoveClassificationState(false);
            } else if (!currentFen) {
                classification.lastFen = null;
            }
            if (currentFen) {
                classification.lastFen = currentFen;
            }
            return;
        }

        const wasEnabled = classification.enabled;
        classification.enabled = true;
        if (!wasEnabled && ChessBot.classifier && typeof ChessBot.classifier.prepare === 'function') {
            ChessBot.classifier.prepare();
        }

        if (!currentFen) {
            return;
        }

        if (!classification.lastFen) {
            classification.lastFen = currentFen;
            precomputeBestSnapshotForCurrentFen(currentFen);
            return;
        }

        if (classification.lastFen === currentFen) {
            precomputeBestSnapshotForCurrentFen(currentFen);
            return;
        }

        const previousFen = classification.lastFen;
        classification.lastFen = currentFen;
        classification.precomputeLastKey = null;
        classification.precomputeLastAt = 0;

        clearMoveClassificationIcon();
        if (currentFen === config.STARTING_FEN) {
            return;
        }

        const inferredMove = ChessBot.dom.inferPlayedMoveFromFenTransition(previousFen, currentFen);
        if (!inferredMove || !inferredMove.uci || !inferredMove.toSquare) {
            return;
        }

        const nextMoveKey = `${inferredMove.uci}@${currentFen}`;
        if (classification.lastMoveKey === nextMoveKey) {
            return;
        }
        classification.lastMoveKey = nextMoveKey;

        const requestSeq = classification.requestSeq + 1;
        classification.requestSeq = requestSeq;
        classification.inFlight = true;
        if (!ChessBot.classifier || typeof ChessBot.classifier.classifyMove !== 'function') {
            classification.inFlight = false;
            return;
        }

        const depthCap = Math.max(1, Math.min(14, Math.floor(runtime.lastValue) || config.DEFAULT_DEPTH));
        ChessBot.classifier.classifyMove({
            fenBefore: previousFen,
            playedUci: inferredMove.uci,
            depthCap
        }).then(result => {
            if (classification.requestSeq !== requestSeq) {
                return;
            }
            if (!shouldRunMoveClassification()) {
                return;
            }
            if (!result || !result.label) {
                return;
            }
            if (ChessBot.ui && ChessBot.ui.moveClassificationOverlay && typeof ChessBot.ui.moveClassificationOverlay.show === 'function') {
                ChessBot.ui.moveClassificationOverlay.show({
                    toSquare: inferredMove.toSquare,
                    label: result.label
                });
            }
        }).catch(error => {
            if (error && error.code === 'CLASSIFIER_CANCELLED') {
                return;
            }
            ChessBot.logger.debug('Move classification failed', error);
        }).finally(() => {
            if (classification.requestSeq === requestSeq) {
                classification.inFlight = false;
            }
        });
    }

    function pickGameOverNewGameButton(buttons) {
        if (!Array.isArray(buttons) || buttons.length === 0) {
            return null;
        }

        const exactSelectorCandidates = [
            'button[data-cy="game-over-modal-new-game-button"]',
            'button[data-testid="game-over-modal-new-game-button"]',
            '.game-over-buttons-component button[data-cy*="new-game"]'
        ];

        for (const selector of exactSelectorCandidates) {
            const button = document.querySelector(selector);
            if (button && !button.disabled) {
                return button;
            }
        }

        const byDataAttr = buttons.find(btn => {
            if (!btn || btn.disabled) {
                return false;
            }
            const dataCy = (btn.getAttribute('data-cy') || '').toLowerCase();
            const dataTestId = (btn.getAttribute('data-testid') || '').toLowerCase();
            return /new-game|newgame|new-game-button|new.*min/.test(dataCy)
                || /new-game|newgame|new-game-button|new.*min/.test(dataTestId);
        });
        if (byDataAttr) {
            return byDataAttr;
        }

        const byLabel = buttons.find(btn => {
            if (!btn || btn.disabled) {
                return false;
            }
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            return /new game|new \d+ min|ván mới/.test(ariaLabel)
                || /new game|new \d+ min|ván mới/.test(text);
        });
        if (byLabel) {
            return byLabel;
        }

        return null;
    }

    function handleAutoNewGame() {
        if (!myVars.autoNewGame) {
            return false;
        }

        const now = Date.now();
        if (myVars.lastAutoNewGame && (now - myVars.lastAutoNewGame) < config.AUTO_NEW_GAME_COOLDOWN_MS) {
            return false;
        }

        const buttons = ChessBot.dom.getGameOverButtons();
        if (!buttons.length) {
            return false;
        }

        let targetButton = pickGameOverNewGameButton(buttons);

        if (!targetButton) {
            targetButton = buttons.find(btn => btn && !btn.disabled);
        }

        if (targetButton) {
            targetButton.click();
            myVars.lastAutoNewGame = now;
            return true;
        }

        return false;
    }

    async function runSchedulerLoop() {
        while (true) {
            try {
                if (!runtime.extensionEnabled) {
                    await delay(0.5, 1);
                    continue;
                }

                ChessBot.evalBar.updateEvaluationBarDisplay();

                if (!runtime.loaded) {
                    ChessBot.ui.controlPanel.loadControlPanel();
                    await delay(0.1, 0.2);
                    continue;
                }

                runtime.board = ChessBot.dom.getBoardElement() || runtime.board;
                ChessBot.ui.controlPanel.syncSettingsFromPanel();

                if (handleAutoNewGame()) {
                    await delay(0.1, 0.2);
                    continue;
                }

                const clocks = ChessBot.dom.getClockSnapshot();
                const currentFen = ChessBot.dom.resolveCurrentFen();
                if (shouldPauseForGameOver(currentFen)) {
                    await delay(0.1, 0.2);
                    continue;
                }

                const playingAs = resolvePlayingAsFromBoard(clocks);
                handleMoveClassificationTick(currentFen);

                runtime.myTurn = ChessBot.timing.resolveIsMyTurn(playingAs, clocks);
                ChessBot.timing.updateTempoStats(Boolean(runtime.myTurn));

                ChessBot.ui.controlPanel.setDepthLabel(runtime.lastValue);
                myVars.isThinking = runtime.isThinking;
                ChessBot.ui.controlPanel.updateSpinner();

                const shouldAutoRun = shouldAnalyzeCurrentTurn();
                if (!runtime.isThinking && shouldAutoRun) {
                    const hasFreshPosition = Boolean(currentFen && currentFen !== myVars.lastAnalyzedFen);
                    if (hasFreshPosition) {
                        const suppressOnFreshPosition = !myVars.evalOnly && runtime.myTurn;
                        const started = ChessBot.engine.runChessEngine(runtime.lastValue, suppressOnFreshPosition ? { suppressHints: true } : {});
                        if (!started) {
                            await delay(0.1, 0.2);
                        }
                        continue;
                    }

                    const { minDelayVal, maxDelayVal } = ChessBot.ui.controlPanel.getDelayBounds();
                    const moveNumber = ChessBot.dom.getMoveNumberEstimate();
                    const captureStats = ChessBot.dom.getCapturedMaterialStats();
                    const phase = ChessBot.timing.estimateGamePhase(moveNumber, captureStats);
                    const clockContext = ChessBot.timing.resolveClockContext(clocks, playingAs);

                    if (!Number.isFinite(myVars.detectedTimeControl) || myVars.detectedTimeControl <= 0) {
                        const inferred = ChessBot.timing.inferTimeControlMinutes(clockContext, moveNumber);
                        if (Number.isFinite(inferred) && inferred > 0) {
                            myVars.detectedTimeControl = inferred;
                        }
                    }

                    const humanDelaySec = ChessBot.timing.computeAutoRunDelaySeconds({
                        myTime: clockContext.myTime,
                        oppTime: clockContext.oppTime,
                        phase,
                        moveNumber,
                        captureStats,
                        playingAs,
                        minBound: minDelayVal,
                        maxBound: maxDelayVal,
                        timeControlMinutes: myVars.detectedTimeControl,
                        playerTempo: ChessBot.timing.getTempoSeconds(true),
                        opponentTempo: ChessBot.timing.getTempoSeconds(false),
                        engineVolatility: engineMetrics.volatility,
                        engineSpeed: engineMetrics.nps,
                        engineDepth: Number.isFinite(evaluationState.depth) ? evaluationState.depth : engineMetrics.seldepth,
                        evaluationType: evaluationState.type,
                        evaluationValue: evaluationState.value,
                        evalOnly: myVars.evalOnly
                    });

                    myVars.lastHumanDelaySec = humanDelaySec;
                    const wasMyTurnAtSchedule = runtime.myTurn;

                    await waitForSeconds(humanDelaySec);
                    runtime.board = ChessBot.dom.getBoardElement() || runtime.board;
                    const isMyTurnNow = ChessBot.timing.resolveIsMyTurn(myVars.playingAs);

                    if (!myVars.evalOnly && !wasMyTurnAtSchedule && isMyTurnNow) {
                        const started = ChessBot.engine.runChessEngine(runtime.lastValue, { suppressHints: true });
                        if (!started) {
                            await delay(0.1, 0.2);
                        }
                        continue;
                    }

                    if (runtime.isThinking || !runtime.extensionEnabled) {
                        continue;
                    }

                    const started = ChessBot.engine.runChessEngine(runtime.lastValue);
                    if (!started) {
                        await delay(0.1, 0.2);
                    }
                }

                await delay(0.1, 0.2);
            } catch (error) {
                ChessBot.logger.error('Main loop error', error);
                await delay(0.2, 0.4);
            }
        }
    }

    function handleDepthHotkeys(event) {
        if (event.defaultPrevented || !runtime.extensionEnabled) {
            return;
        }

        const target = event.target;
        if (target) {
            const tag = (target.tagName || '').toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
                return;
            }
        }

        const depth = config.DEPTH_HOTKEYS[event.keyCode];
        if (depth !== undefined) {
            ChessBot.engine.runChessEngine(depth);
            event.preventDefault();
        }
    }

    function bindPublicAPI() {
        myFunctions.stopSf = ChessBot.engine.stopSf;
        myFunctions.reloadChessEngine = ChessBot.engine.reloadChessEngine;
        myFunctions.loadChessEngine = ChessBot.engine.loadChessEngine;
        myFunctions.runChessEngine = ChessBot.engine.runChessEngine;
        myFunctions.movePiece = movePiece;
        myFunctions.color = colorBestMove;
        myFunctions.handleAutoNewGame = handleAutoNewGame;
        myFunctions.loadEx = ChessBot.ui.controlPanel.loadControlPanel;
        myFunctions.spinner = ChessBot.ui.controlPanel.updateSpinner;

        window.setChessBotEnabled = setChessBotEnabled;
    }

    function startWhenBoardReady() {
        const waitForChessBoard = setInterval(() => {
            const gameBoard = ChessBot.dom.getBoardElement();
            if (!gameBoard) {
                return;
            }

            clearInterval(waitForChessBoard);
            runtime.board = gameBoard;

            ChessBot.ui.controlPanel.loadControlPanel();
            ChessBot.engine.loadChessEngine();
            runSchedulerLoop();
        }, 1000);
    }

    function start() {
        bindPublicAPI();
        window.addEventListener('keydown', handleDepthHotkeys, true);
        startWhenBoardReady();
    }

    ChessBot.scheduler = {
        start
    };
})();
