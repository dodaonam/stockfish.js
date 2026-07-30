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

  function normalizeMovetimeSec(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 1000 : config.DEFAULT_MOVETIME_SEC;
  }

  function buildAnalysisKey(fen) {
    return fen ? `${fen}|${normalizeMovetimeSec(settings.goMovetimeSec)}` : "";
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
    if (resetLastRequested) {
      runtime.lastRequestedFen = null;
      runtime.lastRequestedAnalysisKey = null;
    }
  }

  function setChessBotEnabled(enabled) {
    runtime.extensionEnabled = enabled !== false;
    const root = document.getElementById("lc0-control-root");
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
    runtime.lastRequestedFen = fen;
    runtime.lastRequestedAnalysisKey = analysisKey;
    runtime.isThinking = true;

    try {
      const response = await ChessBot.bridge.requestBestMove({
        requestId,
        fen,
        movetimeSec: settings.goMovetimeSec
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
        }
      } else {
        await ChessBot.bridge.highlightMoveUci(bestmove);
        runtime.highlightForFen = current.fen;
        ChessBot.logger.info("Best move", bestmove);
      }
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

  async function runSchedulerLoop() {
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
        }

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
