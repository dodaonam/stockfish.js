(function() {
  "use strict";

  const ChessBot = window.ChessBot;
  const { runtime, settings, evaluationState } = ChessBot.state;
  const ROOT_ID = "lc0u-eval-root";
  const STYLE_ID = "lc0u-eval-style";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID}{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;height:100%;padding:6px 0;font-family:'Segoe UI',Roboto,sans-serif;color:#111;}
#${ROOT_ID}.lc0u-eval-dark{color:#fff;}
#${ROOT_ID} .lc0u-eval-bar{position:relative;width:28px;flex:1 1 auto;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;background:#888;box-shadow:0 0 0 1px rgba(0,0,0,.35);transition:box-shadow .2s ease;}
#${ROOT_ID}.lc0u-eval-thinking .lc0u-eval-bar{box-shadow:0 0 0 1px rgba(255,180,70,.65),0 0 12px rgba(255,180,70,.35);}
#${ROOT_ID} .lc0u-eval-fill{width:100%;transition:height .18s ease;}
#${ROOT_ID} .lc0u-eval-fill-black{background:#262421;}
#${ROOT_ID} .lc0u-eval-fill-white{background:#fff;}
#${ROOT_ID}.lc0u-player-black .lc0u-eval-bar{flex-direction:column-reverse;}
#${ROOT_ID} .lc0u-eval-pointer{position:absolute;left:50%;transform:translate(-50%,-50%);width:22px;height:2px;border-radius:1px;background:#ff5252;box-shadow:0 0 6px rgba(255,82,82,.55);transition:top .18s ease;}
#${ROOT_ID} .lc0u-eval-score-container{position:absolute;left:0;right:0;display:flex;justify-content:center;z-index:5;transition:all .18s ease;}
#${ROOT_ID} .lc0u-score-top{top:4px;bottom:auto;}
#${ROOT_ID} .lc0u-score-bottom{bottom:4px;top:auto;}
#${ROOT_ID} .lc0u-eval-score{font-weight:600;min-width:28px;font-size:11px;padding:2px 4px;border-radius:2px;text-align:center;}
#${ROOT_ID} .lc0u-score-light{color:#000;background:rgba(255,255,255,.95);}
#${ROOT_ID} .lc0u-score-dark{color:#fff;background:rgba(38,36,33,.95);}
`;
    document.head.appendChild(style);
  }

  function findHost() {
    if (location.hostname === "www.chess.com") {
      return document.querySelector("#board-layout-evaluation");
    }
    const board = document.querySelector("main.round .round__app .cg-wrap, main.round .cg-wrap");
    if (!board) return null;
    let host = document.getElementById("lc0u-lichess-evaluation-host");
    if (host && !board.parentElement?.contains(host)) host.remove();
    if (!host || !host.isConnected) {
      host = document.createElement("div");
      host.id = "lc0u-lichess-evaluation-host";
      host.style.cssText = "position:absolute;left:-43px;top:0;width:34px;height:100%;z-index:5;";
      const parent = board.parentElement;
      if (!parent) return null;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent.insertBefore(host, board);
    }
    host.style.height = Math.max(0, board.getBoundingClientRect().height) + "px";
    return host;
  }

  function ensureRoot() {
    const host = findHost();
    if (!host) {
      return null;
    }
    ensureStyle();
    let root = document.getElementById(ROOT_ID);
    if (!root || !host.contains(root)) {
      if (!root) {
        root = document.createElement("div");
        root.id = ROOT_ID;
        root.innerHTML = `
<div class="lc0u-eval-bar">
  <div class="lc0u-eval-fill lc0u-eval-fill-black" style="height:50%;"></div>
  <span class="lc0u-eval-pointer" style="top:50%;"></span>
  <div class="lc0u-eval-fill lc0u-eval-fill-white" style="height:50%;"></div>
  <div class="lc0u-eval-score-container lc0u-score-bottom">
    <span class="lc0u-eval-score lc0u-score-light"></span>
  </div>
</div>`;
      }
      host.appendChild(root);
    }
    return root;
  }

  function getWhiteCentipawns() {
    if (!evaluationState.type || !Number.isFinite(evaluationState.value)) {
      return null;
    }
    const multiplier = evaluationState.sideToMove === "b" ? -1 : 1;
    if (evaluationState.type === "mate") {
      const mate = evaluationState.value === 0 ? -1 : evaluationState.value;
      return mate * multiplier > 0 ? 1000 : -1000;
    }
    return evaluationState.value * multiplier;
  }

  function toWhiteFraction(cp) {
    if (!Number.isFinite(cp)) {
      return 0.5;
    }
    if (evaluationState.type === "mate") {
      return cp > 0 ? 1 : 0;
    }
    const clamped = Math.max(-10000, Math.min(10000, cp));
    const pawns = clamped / 100;
    const adjusted = Math.sign(pawns) * Math.pow(Math.abs(pawns), 0.85);
    return 0.5 + 0.5 * Math.tanh(adjusted / 4);
  }

  function formatScore(cp) {
    if (!Number.isFinite(cp)) {
      return "…";
    }
    if (evaluationState.type === "mate") {
      const mateForWhite = evaluationState.value * (evaluationState.sideToMove === "b" ? -1 : 1);
      return `M${Math.abs(mateForWhite)}`;
    }
    const absolute = Math.abs(cp);
    const decimals = absolute < 100 ? 2 : absolute < 1000 ? 1 : 0;
    return (absolute / 100).toFixed(decimals);
  }

  function updateEvaluationBarDisplay() {
    const root = ensureRoot();
    if (!root) {
      return;
    }
    const visible = runtime.extensionEnabled && settings.showEvalBar;
    root.style.display = visible ? "" : "none";
    if (!visible) {
      return;
    }

    root.classList.toggle("lc0u-eval-dark", !!document.body?.classList.contains("theme-dark"));
    root.classList.toggle("lc0u-eval-thinking", runtime.evalInFlightId !== null);
    root.classList.toggle("lc0u-player-black", runtime.playerColor === "black");

    const score = root.querySelector(".lc0u-eval-score");
    const scoreContainer = root.querySelector(".lc0u-eval-score-container");
    const whiteFill = root.querySelector(".lc0u-eval-fill-white");
    const blackFill = root.querySelector(".lc0u-eval-fill-black");
    const pointer = root.querySelector(".lc0u-eval-pointer");
    const hasEvaluation = evaluationState.fen && evaluationState.type && Number.isFinite(evaluationState.value);
    if (!runtime.isInActiveGame || !hasEvaluation) {
      if (score) {
        score.textContent = "";
        score.classList.remove("lc0u-score-light", "lc0u-score-dark");
      }
      if (scoreContainer) {
        scoreContainer.classList.remove("lc0u-score-top", "lc0u-score-bottom");
      }
      if (whiteFill) whiteFill.style.height = "50%";
      if (blackFill) blackFill.style.height = "50%";
      if (pointer) pointer.style.top = "50%";
      return;
    }

    const cpWhite = getWhiteCentipawns();
    const whitePercent = Math.max(0, Math.min(100, Math.round(toWhiteFraction(cpWhite) * 1000) / 10));
    if (whiteFill) whiteFill.style.height = `${whitePercent}%`;
    if (blackFill) blackFill.style.height = `${100 - whitePercent}%`;
    if (pointer) pointer.style.top = runtime.playerColor === "black" ? `${whitePercent}%` : `${100 - whitePercent}%`;
    if (score) score.textContent = formatScore(cpWhite);

    const playerCp = runtime.playerColor === "black" ? -cpWhite : cpWhite;
    const opponentAdvantage = Number.isFinite(playerCp) && playerCp < -10;
    if (scoreContainer) {
      scoreContainer.classList.toggle("lc0u-score-top", opponentAdvantage);
      scoreContainer.classList.toggle("lc0u-score-bottom", !opponentAdvantage);
    }
    if (score) {
      const playerAdvantage = Number.isFinite(playerCp) && playerCp >= -10;
      score.classList.toggle("lc0u-score-light", runtime.playerColor === "white" ? playerAdvantage : !playerAdvantage);
      score.classList.toggle("lc0u-score-dark", runtime.playerColor === "white" ? !playerAdvantage : playerAdvantage);
    }
  }

  function reset() {
    evaluationState.fen = null;
    evaluationState.sideToMove = null;
    evaluationState.type = null;
    evaluationState.value = null;
    evaluationState.depth = null;
    evaluationState.updatedAt = 0;
    updateEvaluationBarDisplay();
  }

  ChessBot.evalBar = {
    updateEvaluationBarDisplay,
    reset
  };
})();
