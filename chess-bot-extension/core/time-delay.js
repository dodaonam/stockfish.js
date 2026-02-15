(function() {
    'use strict';

    const ChessBot = window.ChessBot;
    const {
        config,
        runtime,
        tempoStats,
        myVars
    } = ChessBot.state;

    function normalizePlayingAsColor(value) {
        if (value === 1 || value === '1' || value === 'white' || value === 'w') {
            return 'white';
        }
        if (value === 2 || value === '2' || value === 'black' || value === 'b') {
            return 'black';
        }
        return null;
    }

    function clamp(value, min, max) {
        if (!Number.isFinite(value)) {
            return min;
        }
        return Math.min(Math.max(value, min), max);
    }

    function updateMovingAverage(current, sample, weight = 0.2) {
        if (!Number.isFinite(sample) || sample <= 0) {
            return current;
        }
        if (!Number.isFinite(current) || current <= 0) {
            return sample;
        }
        return current + (sample - current) * clamp(weight, 0, 1);
    }

    function getPlayerColor() {
        const stored = myVars.playingAs;
        return normalizePlayingAsColor(stored) || 'white';
    }

    function getTempoSeconds(isPlayer) {
        const ms = isPlayer ? tempoStats.myAverageMs : tempoStats.oppAverageMs;
        return Number.isFinite(ms) && ms > 0 ? ms / 1000 : null;
    }

    function updateTempoStats(isMyTurn) {
        const now = Date.now();
        if (isMyTurn) {
            if (tempoStats.lastIsMyTurn !== true) {
                tempoStats.myTurnStartedAt = now;
                if (tempoStats.oppTurnStartedAt) {
                    const oppSample = now - tempoStats.oppTurnStartedAt;
                    tempoStats.oppAverageMs = updateMovingAverage(tempoStats.oppAverageMs, oppSample);
                    tempoStats.oppTurnStartedAt = null;
                }
            }
        } else if (tempoStats.lastIsMyTurn !== false) {
            tempoStats.oppTurnStartedAt = now;
            if (tempoStats.myTurnStartedAt) {
                const mySample = now - tempoStats.myTurnStartedAt;
                tempoStats.myAverageMs = updateMovingAverage(tempoStats.myAverageMs, mySample);
                tempoStats.myTurnStartedAt = null;
            }
        }
        tempoStats.lastIsMyTurn = isMyTurn;
    }

    function resetTempoStats() {
        tempoStats.myTurnStartedAt = null;
        tempoStats.oppTurnStartedAt = null;
        tempoStats.myAverageMs = null;
        tempoStats.oppAverageMs = null;
        tempoStats.lastIsMyTurn = null;
    }

    function estimateGamePhase(moveNumber, captureStats) {
        const totalValue = captureStats ? captureStats.totalValue : 0;
        if (moveNumber <= 12 && totalValue < 6) {
            return 'opening';
        }
        if (moveNumber >= 35 || totalValue > 20) {
            return 'endgame';
        }
        return 'middlegame';
    }

    function getPhaseBaseLookup(timeControlMinutes) {
        const minutes = Number.isFinite(timeControlMinutes) ? timeControlMinutes : 3;
        if (minutes <= 1.5) {
            return { opening: 0.35, middlegame: 0.7, endgame: 1.1 };
        }
        if (minutes <= 3.5) {
            return { opening: 0.75, middlegame: 1.8, endgame: 2.7 };
        }
        if (minutes <= 7.5) {
            return { opening: 0.95, middlegame: 2.4, endgame: 3.4 };
        }
        return { opening: 1.2, middlegame: 3.2, endgame: 4.6 };
    }

    function computeHumanDelay(context) {
        const {
            myTime,
            oppTime,
            phase,
            moveNumber,
            captureStats,
            playingAs,
            minBound,
            maxBound,
            timeControlMinutes,
            playerTempo,
            opponentTempo,
            engineVolatility,
            engineSpeed,
            engineDepth,
            evaluationType,
            evaluationValue
        } = context;

        const baseLookup = getPhaseBaseLookup(timeControlMinutes);
        const basePhaseDelay = baseLookup[phase] || 1.5;
        let delay = basePhaseDelay;

        if (Number.isFinite(moveNumber) && moveNumber <= 6) {
            delay *= 0.85;
        }

        if (Number.isFinite(myTime)) {
            if (myTime < 15) {
                delay *= 0.25;
            } else if (myTime < 30) {
                delay *= 0.4;
            } else if (myTime < 60) {
                delay *= 0.65;
            } else if (myTime > 240) {
                delay *= 1.15;
            }
        }

        if (Number.isFinite(myTime) && Number.isFinite(oppTime)) {
            const ratio = oppTime > 0 ? myTime / oppTime : 1;
            if (ratio < 0.75) {
                delay *= 0.85;
            } else if (ratio > 1.5) {
                delay *= 1.1;
            }
        }

        let materialSwing = 0;
        if (captureStats && playingAs) {
            const myCaptured = playingAs === 'white' ? captureStats.blackCaptured.value : captureStats.whiteCaptured.value;
            const oppCaptured = playingAs === 'white' ? captureStats.whiteCaptured.value : captureStats.blackCaptured.value;
            materialSwing = myCaptured - oppCaptured;
        }
        if (materialSwing > 3) {
            delay *= 1.1;
        } else if (materialSwing < -3) {
            delay *= 0.9;
        }

        if (Number.isFinite(playerTempo)) {
            const tempoRatio = clamp(playerTempo / Math.max(0.25, basePhaseDelay), 0.3, 3);
            if (tempoRatio > 1.1) {
                delay *= 1 + Math.min(tempoRatio - 1, 0.8) * 0.35;
            } else if (tempoRatio < 0.9) {
                delay *= 1 - Math.min(1 - tempoRatio, 0.6) * 0.4;
            }
        }

        if (Number.isFinite(opponentTempo)) {
            if (opponentTempo < basePhaseDelay * 0.7) {
                delay *= 0.9;
            } else if (opponentTempo > basePhaseDelay * 1.7) {
                delay *= 1.08;
            }
        }

        if (Number.isFinite(engineVolatility)) {
            if (engineVolatility > 600) {
                delay *= 1.2;
            } else if (engineVolatility < 120) {
                delay *= 0.95;
            }
        }

        if (evaluationType === 'mate' && Number.isFinite(evaluationValue)) {
            delay *= evaluationValue > 0 ? 0.75 : 0.6;
        }

        if (Number.isFinite(engineDepth) && engineDepth >= 26) {
            delay *= 0.92;
        }

        if (Number.isFinite(engineSpeed) && engineSpeed > 1500000) {
            delay *= 0.95;
        }

        const spread = Math.max(0.05, delay * 0.25);
        delay += (Math.random() - 0.5) * spread;
        delay += Math.random() * spread * 0.25;

        const lowerBound = Number.isFinite(minBound) ? Math.max(0.1, minBound) : 0.3;
        const upperBound = Number.isFinite(maxBound) ? Math.max(lowerBound, maxBound) : 6;

        if (!Number.isFinite(delay) || delay <= 0) {
            delay = lowerBound;
        }

        return Math.max(lowerBound, Math.min(upperBound, delay));
    }

    function quantizeTimeControlMinutes(minutes) {
        if (!Number.isFinite(minutes) || minutes <= 0) {
            return null;
        }
        let best = config.COMMON_TIME_CONTROL_MINUTES[0];
        let bestDistance = Math.abs(minutes - best);
        for (let i = 1; i < config.COMMON_TIME_CONTROL_MINUTES.length; i++) {
            const candidate = config.COMMON_TIME_CONTROL_MINUTES[i];
            const distance = Math.abs(minutes - candidate);
            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }

        if (minutes > 30) {
            return Math.round(minutes);
        }
        return best;
    }

    function inferTimeControlMinutes(clockContext, moveNumber) {
        const myTime = Number.isFinite(clockContext && clockContext.myTime) ? clockContext.myTime : 0;
        const oppTime = Number.isFinite(clockContext && clockContext.oppTime) ? clockContext.oppTime : 0;
        const observedSeconds = Math.max(myTime, oppTime);
        if (observedSeconds <= 0) {
            return null;
        }

        let estimateMinutes = observedSeconds / 60;
        if (Number.isFinite(moveNumber) && moveNumber > 8) {
            estimateMinutes += Math.min(2.5, (moveNumber - 8) * 0.05);
        }
        return quantizeTimeControlMinutes(estimateMinutes);
    }

    function resolveClockContext(clocks, playingAs) {
        const safeClocks = clocks || {};
        const top = safeClocks.top || {};
        const bottom = safeClocks.bottom || {};

        const playerColor = normalizePlayingAsColor(playingAs);
        const topColor = normalizePlayingAsColor(top.color);
        const bottomColor = normalizePlayingAsColor(bottom.color);

        if (playerColor && playerColor === bottomColor) {
            return {
                myTime: Number.isFinite(bottom.seconds) ? bottom.seconds : null,
                oppTime: Number.isFinite(top.seconds) ? top.seconds : null
            };
        }

        if (playerColor && playerColor === topColor) {
            return {
                myTime: Number.isFinite(top.seconds) ? top.seconds : null,
                oppTime: Number.isFinite(bottom.seconds) ? bottom.seconds : null
            };
        }

        return {
            myTime: Number.isFinite(bottom.seconds) ? bottom.seconds : null,
            oppTime: Number.isFinite(top.seconds) ? top.seconds : null
        };
    }

    function resolveIsMyTurn(playingAs, clocks) {
        if (runtime.board && runtime.board.game && typeof runtime.board.game.getTurn === 'function' && typeof runtime.board.game.getPlayingAs === 'function') {
            return runtime.board.game.getTurn() === runtime.board.game.getPlayingAs();
        }

        const snapshot = clocks || ChessBot.dom.getClockSnapshot();
        const normalizedColor = normalizePlayingAsColor(playingAs) || 'white';
        const bottomColor = normalizePlayingAsColor(snapshot && snapshot.bottom ? snapshot.bottom.color : null);
        const topColor = normalizePlayingAsColor(snapshot && snapshot.top ? snapshot.top.color : null);

        if (normalizedColor === bottomColor) {
            return !!(snapshot && snapshot.bottom && snapshot.bottom.isTurn);
        }
        if (normalizedColor === topColor) {
            return !!(snapshot && snapshot.top && snapshot.top.isTurn);
        }
        return !!(snapshot && snapshot.bottom && snapshot.bottom.isTurn);
    }

    function computeAutoRunDelaySeconds(options) {
        const {
            myTime,
            oppTime,
            phase,
            moveNumber,
            captureStats,
            playingAs,
            minBound,
            maxBound,
            timeControlMinutes,
            playerTempo,
            opponentTempo,
            engineVolatility,
            engineSpeed,
            engineDepth,
            evaluationType,
            evaluationValue,
            evalOnly
        } = options || {};

        let lowerBound = Number.isFinite(minBound) ? Math.max(0.1, minBound) : 0.1;
        let upperBound = Number.isFinite(maxBound) ? Math.max(lowerBound, maxBound) : Math.max(lowerBound, 1);

        if (evalOnly) {
            upperBound = Math.min(upperBound, config.EVAL_ONLY_FAST_CAP_SECONDS);
            lowerBound = Math.min(lowerBound, upperBound);
        }

        const delay = computeHumanDelay({
            myTime,
            oppTime,
            phase,
            moveNumber,
            captureStats,
            playingAs,
            minBound: lowerBound,
            maxBound: upperBound,
            timeControlMinutes,
            playerTempo,
            opponentTempo,
            engineVolatility,
            engineSpeed,
            engineDepth,
            evaluationType,
            evaluationValue
        });

        if (!Number.isFinite(delay) || delay <= 0) {
            return lowerBound;
        }
        return clamp(delay, lowerBound, upperBound);
    }

    ChessBot.timing = {
        normalizePlayingAsColor,
        clamp,
        updateMovingAverage,
        getPlayerColor,
        getTempoSeconds,
        updateTempoStats,
        resetTempoStats,
        estimateGamePhase,
        computeHumanDelay,
        quantizeTimeControlMinutes,
        inferTimeControlMinutes,
        resolveClockContext,
        resolveIsMyTurn,
        computeAutoRunDelaySeconds
    };
})();
