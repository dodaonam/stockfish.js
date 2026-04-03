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
    const safeMin = Math.min(low, high);
    const safeMax = Math.max(low, high);
    return Math.random() * (safeMax - safeMin) + safeMin;
  }

  function normalizeMovetimeSec(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return config.DEFAULT_MOVETIME_SEC;
    }
    return Math.round(numeric * 1000) / 1000;
  }

  function buildAnalysisKey(fen) {
    if (!fen) {
      return "";
    }
    return `${fen}|${settings.searchMode}|${normalizeMovetimeSec(settings.goMovetimeSec)}`;
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

    const root = ChessBot.dom.getControlPanelRoot();
    if (root) {
      root.style.display = runtime.extensionEnabled ? "" : "none";
    }

    if (!runtime.extensionEnabled) {
      clearPending(false);
      ChessBot.dom.clearHighlights();
    } else {
      runtime.lastRequestedFen = null;
      runtime.lastRequestedAnalysisKey = null;
    }
  }

  function shouldRequestAnalysis(fen) {
    if (!runtime.extensionEnabled) {
      return false;
    }
    if (!settings.autoRun) {
      return false;
    }
    if (!ChessBot.dom.isLiveGameContext()) {
      return false;
    }
    if (!fen) {
      return false;
    }
    if (!ChessBot.dom.isMyTurn()) {
      return false;
    }
    if (runtime.inFlightRequestId) {
      return false;
    }
    const analysisKey = buildAnalysisKey(fen);
    if (!analysisKey) {
      return false;
    }
    return analysisKey !== runtime.lastRequestedAnalysisKey;
  }

  async function requestBestMoveForFen(fen, analysisKey) {
    const key = analysisKey || buildAnalysisKey(fen);
    const requestId = ChessBot.bridge.makeRequestId("bestmove");
    runtime.inFlightRequestId = requestId;
    runtime.inFlightFen = fen;
    runtime.inFlightAnalysisKey = key;
    runtime.lastRequestedFen = fen;
    runtime.lastRequestedAnalysisKey = key;
    runtime.isThinking = true;

    try {
      const response = await ChessBot.bridge.requestBestMove({
        requestId,
        fen,
        movetimeSec: settings.goMovetimeSec,
        searchMode: settings.searchMode,
        timeoutMs: config.REQUEST_TIMEOUT_MS
      });

      if (runtime.inFlightRequestId !== requestId) {
        return;
      }

      if (!response || !response.ok) {
        ChessBot.logger.warn("Bestmove request failed", response && response.error ? response.error : response);
        return;
      }

      const bestmove = response.result && typeof response.result.bestmove === "string"
        ? response.result.bestmove.toLowerCase()
        : "";

      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestmove)) {
        ChessBot.logger.warn("Ignoring invalid bestmove", bestmove);
        return;
      }

      const currentFen = ChessBot.dom.resolveCurrentFen();
      if (currentFen !== fen) {
        ChessBot.logger.debug("Dropping stale bestmove result", { requestId, fenAtRequest: fen, currentFen });
        return;
      }

      if (settings.autoMove) {
        const applied = ChessBot.dom.movePieceUci(bestmove);
        if (!applied) {
          ChessBot.logger.warn("Bestmove could not be applied", { bestmove });
          ChessBot.dom.highlightMoveUci(bestmove);
          runtime.highlightForFen = currentFen;
        } else {
          ChessBot.dom.clearHighlights();
          runtime.highlightForFen = null;
        }
      } else {
        ChessBot.dom.highlightMoveUci(bestmove);
        runtime.highlightForFen = currentFen;
        ChessBot.logger.info("Best move", bestmove);
      }

      runtime.lastAppliedFen = currentFen;
    } catch (error) {
      if (runtime.inFlightRequestId === requestId) {
        ChessBot.logger.warn("Bestmove request threw", error);
      }
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

        runtime.board = ChessBot.dom.getBoardElement() || runtime.board;
        ChessBot.ui.controlPanel.syncSettingsFromPanel();

        const fen = ChessBot.dom.resolveCurrentFen();
        if (!fen) {
          clearPending(false);
          ChessBot.dom.clearHighlights();
          await sleep(config.LOOP_INTERVAL_MS);
          continue;
        }

        if (runtime.highlightForFen && fen !== runtime.highlightForFen) {
          ChessBot.dom.clearHighlights();
          runtime.highlightForFen = null;
        }

        if (runtime.pendingDueAt > 0) {
          const desiredAnalysisKey = buildAnalysisKey(fen);
          if (
            settings.autoRun &&
            ChessBot.dom.isMyTurn() &&
            desiredAnalysisKey &&
            (runtime.pendingFen !== fen || runtime.pendingAnalysisKey !== desiredAnalysisKey)
          ) {
            const rescheduleDelaySec = randomBetween(settings.randomDelayMinSec, settings.randomDelayMaxSec);
            runtime.pendingFen = fen;
            runtime.pendingAnalysisKey = desiredAnalysisKey;
            runtime.pendingDueAt = Date.now() + Math.round(rescheduleDelaySec * 1000);
          }

          if (Date.now() >= runtime.pendingDueAt) {
            const pendingFen = runtime.pendingFen;
            const pendingAnalysisKey = runtime.pendingAnalysisKey;
            runtime.pendingDueAt = 0;
            runtime.pendingFen = null;
            runtime.pendingAnalysisKey = null;

            const currentFen = ChessBot.dom.resolveCurrentFen();
            const currentAnalysisKey = buildAnalysisKey(currentFen);
            if (
              pendingFen &&
              pendingAnalysisKey &&
              currentFen === pendingFen &&
              currentAnalysisKey === pendingAnalysisKey &&
              settings.autoRun &&
              ChessBot.dom.isMyTurn() &&
              !runtime.inFlightRequestId
            ) {
              await requestBestMoveForFen(pendingFen, pendingAnalysisKey);
            }
          }
          await sleep(config.LOOP_INTERVAL_MS);
          continue;
        }

        if (shouldRequestAnalysis(fen)) {
          const delaySec = randomBetween(settings.randomDelayMinSec, settings.randomDelayMaxSec);
          const analysisKey = buildAnalysisKey(fen);
          runtime.pendingFen = fen;
          runtime.pendingAnalysisKey = analysisKey;
          runtime.pendingDueAt = Date.now() + Math.round(delaySec * 1000);
        }

        await sleep(config.LOOP_INTERVAL_MS);
      } catch (error) {
        ChessBot.logger.error("Scheduler loop error", error);
        await sleep(250);
      }
    }
  }

  function startWhenBoardReady() {
    const waiter = setInterval(() => {
      const board = ChessBot.dom.getBoardElement();
      if (!board) {
        return;
      }

      clearInterval(waiter);
      runtime.board = board;
      ChessBot.ui.controlPanel.loadControlPanel();
      runSchedulerLoop();
    }, 500);
  }

  function start() {
    window.setChessBotEnabled = setChessBotEnabled;
    startWhenBoardReady();
  }

  ChessBot.scheduler = {
    start
  };
})();
