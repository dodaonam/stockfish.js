(function() {
  "use strict";

  const ChessBot = window.ChessBot;
  const { config, runtime, settings } = ChessBot.state;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomBetween(min, max) {
    const low = Number.isFinite(min) ? min : config.DEFAULT_RANDOM_DELAY_MIN_SEC;
    const high = Number.isFinite(max) ? max : config.DEFAULT_RANDOM_DELAY_MAX_SEC;
    return Math.random() * (Math.max(low, high) - Math.min(low, high)) + Math.min(low, high);
  }

  function buildAnalysisKey(fen) {
    if (!fen) return "";
    return `${fen}|depth:${Math.round(settings.depth)}|limit:${settings.limitStrength ? settings.elo : "off"}`;
  }

  function clearPending(resetLastRequested = false) {
    runtime.pendingFen = null;
    runtime.pendingAnalysisKey = null;
    runtime.pendingDueAt = 0;
    runtime.inFlightRequestId = null;
    runtime.inFlightFen = null;
    runtime.inFlightAnalysisKey = null;
    runtime.isThinking = false;
    runtime.highlightForFen = null;
    runtime.bestMoveForFen = null;
    if (resetLastRequested) {
      runtime.lastRequestedFen = null;
      runtime.lastRequestedAnalysisKey = null;
    }
  }

  function setChessBotEnabled(enabled) {
    runtime.extensionEnabled = enabled !== false;
    const root = document.getElementById("stf-control-root");
    if (root) {
      root.style.display = runtime.extensionEnabled ? "" : "none";
    }
    if (!runtime.extensionEnabled) {
      clearPending(false);
      ChessBot.bridge.clearHighlights().catch(() => {});
    } else {
      runtime.lastRequestedFen = null;
      runtime.lastRequestedAnalysisKey = null;
    }
  }

  function canRequestAnalysis(pageState) {
    if (!runtime.extensionEnabled || !settings.autoRun || runtime.inFlightRequestId) {
      return false;
    }
    if (!pageState.isLiveGame || !pageState.isMyTurn || !pageState.fen) {
      return false;
    }
    const analysisKey = buildAnalysisKey(pageState.fen);
    return !!analysisKey && analysisKey !== runtime.lastRequestedAnalysisKey;
  }

  async function requestBestMoveForFen(fen, analysisKey) {
    const requestId = ChessBot.bridge.makeRequestId("bestmove");
    runtime.inFlightRequestId = requestId;
    runtime.inFlightFen = fen;
    runtime.inFlightAnalysisKey = analysisKey;
    runtime.isThinking = true;

    try {
      const response = await ChessBot.bridge.requestBestMove({
        requestId,
        fen,
        depth: settings.depth,
        limitStrength: settings.limitStrength,
        elo: settings.elo
      });
      if (runtime.inFlightRequestId !== requestId || !response?.ok) {
        if (!response?.ok) ChessBot.logger.warn("Bestmove request failed", response?.error);
        return;
      }
      const bestmove = typeof response.result?.bestmove === "string" ? response.result.bestmove.toLowerCase() : "";
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestmove)) {
        ChessBot.logger.warn("Ignoring invalid bestmove", bestmove);
        return;
      }

      const current = await ChessBot.bridge.getPageState();
      if (current.fen !== fen) {
        ChessBot.logger.debug("Dropping stale bestmove result", { requestId, fenAtRequest: fen, currentFen: current.fen });
        return;
      }
      if (settings.autoMove) {
        const moveResult = await ChessBot.bridge.movePieceUci(bestmove);
        if (moveResult.applied) {
          await ChessBot.bridge.clearHighlights();
          runtime.highlightForFen = null;
        } else {
          await ChessBot.bridge.highlightMoveUci(bestmove);
          runtime.highlightForFen = current.fen;
          ChessBot.logger.warn("Auto move was not applied; allowing retry", { fen, bestmove });
          return;
        }
      } else {
        await ChessBot.bridge.highlightMoveUci(bestmove);
        runtime.highlightForFen = current.fen;
        ChessBot.logger.info("Best move", bestmove);
      }
      runtime.bestMoveForFen = settings.autoMove ? null : { fen, move: bestmove };
      runtime.lastRequestedFen = fen;
      runtime.lastRequestedAnalysisKey = analysisKey;
      runtime.lastAppliedFen = current.fen;
    } catch (error) {
      if (runtime.inFlightRequestId === requestId) ChessBot.logger.warn("Bestmove request threw", error);
    } finally {
      if (runtime.inFlightRequestId === requestId) {
        runtime.inFlightRequestId = null;
        runtime.inFlightFen = null;
        runtime.inFlightAnalysisKey = null;
        runtime.isThinking = false;
      }
    }
  }

  async function applyStoredBestMoveIfAvailable(fen) {
    const stored = runtime.bestMoveForFen;
    if (!settings.autoMove || !stored || stored.fen !== fen || runtime.inFlightRequestId) return false;

    const moveResult = await ChessBot.bridge.movePieceUci(stored.move);
    if (!moveResult.applied) {
      ChessBot.logger.warn("Stored best move was not applied; keeping it available for retry", stored);
      return false;
    }

    await ChessBot.bridge.clearHighlights();
    runtime.highlightForFen = null;
    runtime.lastAppliedFen = fen;
    runtime.bestMoveForFen = null;
    ChessBot.logger.info("Applied stored best move after enabling Auto Move", stored.move);
    return true;
  }

  async function runSchedulerLoop() {
    let previousAutoMove = settings.autoMove;
    while (true) {
      try {
        if (!runtime.extensionEnabled) {
          await sleep(300);
          continue;
        }
        if (!runtime.loaded) {
          ChessBot.ui.controlPanel.loadControlPanel();
          await sleep(150);
          continue;
        }
        ChessBot.ui.controlPanel.syncSettingsFromPanel();
        const state = await ChessBot.bridge.getPageState();
        const fen = state.fen;
        if (!fen) {
          clearPending(false);
          await ChessBot.bridge.clearHighlights();
          await sleep(config.LOOP_INTERVAL_MS);
          continue;
        }
        if (runtime.highlightForFen && fen !== runtime.highlightForFen) {
          await ChessBot.bridge.clearHighlights();
          runtime.highlightForFen = null;
          runtime.bestMoveForFen = null;
        }

        if (!previousAutoMove && settings.autoMove) {
          await applyStoredBestMoveIfAvailable(fen);
        }
        previousAutoMove = settings.autoMove;

        if (runtime.pendingDueAt > 0) {
          const desiredKey = buildAnalysisKey(fen);
          if (settings.autoRun && state.isMyTurn && desiredKey && (runtime.pendingFen !== fen || runtime.pendingAnalysisKey !== desiredKey)) {
            runtime.pendingFen = fen;
            runtime.pendingAnalysisKey = desiredKey;
            runtime.pendingDueAt = Date.now() + Math.round(randomBetween(settings.randomDelayMinSec, settings.randomDelayMaxSec) * 1000);
          }
          if (Date.now() >= runtime.pendingDueAt) {
            const pendingFen = runtime.pendingFen;
            const pendingKey = runtime.pendingAnalysisKey;
            clearPending(false);
            const current = await ChessBot.bridge.getPageState();
            if (pendingFen && pendingKey && current.fen === pendingFen && buildAnalysisKey(current.fen) === pendingKey && settings.autoRun && current.isMyTurn && !runtime.inFlightRequestId) {
              await requestBestMoveForFen(pendingFen, pendingKey);
            }
          }
          await sleep(config.LOOP_INTERVAL_MS);
          continue;
        }
        if (canRequestAnalysis(state)) {
          runtime.pendingFen = fen;
          runtime.pendingAnalysisKey = buildAnalysisKey(fen);
          runtime.pendingDueAt = Date.now() + Math.round(randomBetween(settings.randomDelayMinSec, settings.randomDelayMaxSec) * 1000);
        }
        await sleep(config.LOOP_INTERVAL_MS);
      } catch (error) {
        ChessBot.logger.error("Scheduler loop error", error);
        await sleep(250);
      }
    }
  }

  function startWhenBoardReady() {
    const waiter = setInterval(async () => {
      try {
        const state = await ChessBot.bridge.getPageState();
        if (!state.boardAvailable) return;
        clearInterval(waiter);
        ChessBot.ui.controlPanel.loadControlPanel();
        runSchedulerLoop();
      } catch (_) {
        // The Chess.com board may not be initialized yet.
      }
    }, 500);
  }

  ChessBot.scheduler = { start: () => startWhenBoardReady(), setChessBotEnabled };
})();
