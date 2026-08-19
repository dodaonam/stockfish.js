(function() {
  "use strict";

  const ChessBot = window.ChessBot;
  const { runtime, settings, config } = ChessBot.state;

  const STORAGE_KEYS = [
    "stfAutoRun",
    "stfAutoMove",
    "stfDepth",
    "stfLimitStrength",
    "stfElo",
    "stfRandomDelayMinSec",
    "stfRandomDelayMaxSec"
  ];

  const PANEL_STYLE = `
#stf-control-root{position:fixed;bottom:20px;right:20px;z-index:2147483646;font-family:'Segoe UI',Roboto,sans-serif;}
#stf-control-root .stf-toggle{width:56px;height:56px;border-radius:50%;border:none;background:#3f8f2d;color:#fff;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 10px 22px rgba(0,0,0,.28);}
#stf-control-root .stf-panel{position:absolute;right:0;bottom:70px;width:320px;max-width:calc(100vw - 32px);background:#fff;border-radius:14px;box-shadow:0 14px 30px rgba(0,0,0,.25);padding:14px;opacity:0;pointer-events:none;transform:translateY(12px) scale(.98);transition:opacity .15s ease,transform .15s ease;}
#stf-control-root.stf-open .stf-panel{opacity:1;pointer-events:auto;transform:translateY(0) scale(1);}
#stf-control-root .stf-row{display:flex;align-items:center;gap:8px;margin:8px 0;}
#stf-control-root .stf-row.stf-col{flex-direction:column;align-items:flex-start;}
#stf-control-root label{font-size:13px;color:#1f2937;}
#stf-control-root input[type="number"]{width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box;}
#stf-control-root .stf-title{font-size:14px;font-weight:700;margin:0 0 6px;}
#stf-control-root .stf-sub{margin:0 0 4px;color:#4b5563;font-size:12px;}
`;

  const PANEL_HTML = `
<div class="stf-body">
  <p class="stf-title">STF Settings</p>
  <p class="stf-sub">Stockfish search controls.</p>

  <div class="stf-row">
    <input type="checkbox" id="stfAutoRun">
    <label for="stfAutoRun">Auto Run</label>
  </div>

  <div class="stf-row">
    <input type="checkbox" id="stfAutoMove">
    <label for="stfAutoMove">Auto Move</label>
  </div>

  <div class="stf-row stf-col">
    <label for="stfDepth">Go Depth</label>
    <input type="number" id="stfDepth" step="1" value="12" min="1" max="20">
  </div>

  <div class="stf-row">
    <input type="checkbox" id="stfLimitStrength">
    <label for="stfLimitStrength">Limit Strength</label>
  </div>

  <div class="stf-row stf-col">
    <label for="stfElo">Elo</label>
    <input type="number" id="stfElo" step="100" value="2000" min="1500" max="3000" disabled>
  </div>

  <div class="stf-row stf-col">
    <label for="randomDelayMinSec">Random Delay Min (s)</label>
    <input type="number" id="randomDelayMinSec" step="0.1" value="0" min="0" max="30">
  </div>

  <div class="stf-row stf-col">
    <label for="randomDelayMaxSec">Random Delay Max (s)</label>
    <input type="number" id="randomDelayMaxSec" step="0.1" value="0" min="0" max="30">
  </div>

</div>
`;

  function ensureStyle() {
    if (document.getElementById("stf-control-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "stf-control-style";
    style.textContent = PANEL_STYLE;
    document.head.appendChild(style);
  }

  function getBoardElement() {
    return document.querySelector("chess-board, wc-chess-board");
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  function readNumberOrFallback(rawValue, fallback) {
    const raw = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!raw || raw === "-" || raw === "." || raw === "-." || raw.endsWith(".")) {
      return fallback;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function readRawSettingsFromInputs(baseSettings = settings) {
    return {
      autoRun: byId("stfAutoRun")?.checked ?? baseSettings.autoRun,
      autoMove: byId("stfAutoMove")?.checked ?? baseSettings.autoMove,
      depth: readNumberOrFallback(byId("stfDepth")?.value, baseSettings.depth),
      limitStrength: byId("stfLimitStrength")?.checked ?? baseSettings.limitStrength,
      elo: readNumberOrFallback(byId("stfElo")?.value, baseSettings.elo),
      randomDelayMinSec: readNumberOrFallback(byId("randomDelayMinSec")?.value, baseSettings.randomDelayMinSec),
      randomDelayMaxSec: readNumberOrFallback(byId("randomDelayMaxSec")?.value, baseSettings.randomDelayMaxSec)
    };
  }

  function sanitizeSettings(input) {
    const normalized = {
      autoRun: !!input.autoRun,
      autoMove: !!input.autoMove,
      depth: Math.round(clamp(Number(input.depth), config.DEPTH_MIN, config.DEPTH_MAX)),
      limitStrength: !!input.limitStrength,
      elo: Math.round(clamp(Number(input.elo), config.ELO_MIN, config.ELO_MAX) / 100) * 100,
      randomDelayMinSec: clamp(Number(input.randomDelayMinSec), config.RANDOM_DELAY_SEC_MIN, config.RANDOM_DELAY_SEC_MAX),
      randomDelayMaxSec: clamp(Number(input.randomDelayMaxSec), config.RANDOM_DELAY_SEC_MIN, config.RANDOM_DELAY_SEC_MAX)
    };

    if (normalized.randomDelayMinSec > normalized.randomDelayMaxSec) {
      const swap = normalized.randomDelayMinSec;
      normalized.randomDelayMinSec = normalized.randomDelayMaxSec;
      normalized.randomDelayMaxSec = swap;
    }

    return normalized;
  }

  function readSettingsFromInputs() {
    return sanitizeSettings(readRawSettingsFromInputs());
  }

  function applySettingsToInputs(nextSettings) {
    const safe = sanitizeSettings(nextSettings);

    const autoRun = byId("stfAutoRun");
    const autoMove = byId("stfAutoMove");
    const depth = byId("stfDepth");
    const limitStrength = byId("stfLimitStrength");
    const elo = byId("stfElo");
    const randomDelayMinSec = byId("randomDelayMinSec");
    const randomDelayMaxSec = byId("randomDelayMaxSec");

    if (autoRun) autoRun.checked = safe.autoRun;
    if (autoMove) autoMove.checked = safe.autoMove;
    if (depth) depth.value = String(safe.depth);
    if (limitStrength) limitStrength.checked = safe.limitStrength;
    if (elo) {
      elo.value = String(safe.elo);
      elo.disabled = !safe.limitStrength;
    }
    if (randomDelayMinSec) randomDelayMinSec.value = String(safe.randomDelayMinSec);
    if (randomDelayMaxSec) randomDelayMaxSec.value = String(safe.randomDelayMaxSec);

    Object.assign(settings, safe);
  }

  async function persistSettings(nextSettings) {
    try {
      await ChessBot.bridge.storageSet({
        stfAutoRun: nextSettings.autoRun,
        stfAutoMove: nextSettings.autoMove,
        stfDepth: nextSettings.depth,
        stfLimitStrength: nextSettings.limitStrength,
        stfElo: nextSettings.elo,
        stfRandomDelayMinSec: nextSettings.randomDelayMinSec,
        stfRandomDelayMaxSec: nextSettings.randomDelayMaxSec
      });
    } catch (error) {
      ChessBot.logger.warn("Failed to persist panel settings", error);
    }
  }

  let persistTimer = null;
  function schedulePersist(nextSettings) {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistSettings(nextSettings);
    }, 120);
  }

  async function loadSettingsFromStorage() {
    try {
      const stored = await ChessBot.bridge.storageGet(STORAGE_KEYS);
      applySettingsToInputs({
        ...settings,
        autoRun: stored.stfAutoRun ?? settings.autoRun,
        autoMove: stored.stfAutoMove ?? settings.autoMove,
        depth: stored.stfDepth ?? settings.depth,
        limitStrength: stored.stfLimitStrength ?? settings.limitStrength,
        elo: stored.stfElo ?? settings.elo,
        randomDelayMinSec: stored.stfRandomDelayMinSec ?? settings.randomDelayMinSec,
        randomDelayMaxSec: stored.stfRandomDelayMaxSec ?? settings.randomDelayMaxSec
      });
    } catch (error) {
      ChessBot.logger.warn("Failed to load panel settings from storage", error);
      applySettingsToInputs(settings);
    }
  }

  function syncSettingsFromPanel() {
    const nextSettings = readSettingsFromInputs();
    Object.assign(settings, nextSettings);
    return settings;
  }

  function bindInputListeners(panel) {
    function onSettingsInteraction() {
      const nextSettings = syncSettingsFromPanel();
      applySettingsToInputs(nextSettings);
      schedulePersist(nextSettings);
    }

    function onNumberInput() {
      const nextSettings = sanitizeSettings(readRawSettingsFromInputs());
      Object.assign(settings, nextSettings);
    }

    const numberInputs = panel.querySelectorAll("input[type=\"number\"]");
    numberInputs.forEach(input => {
      input.addEventListener("input", onNumberInput);
      input.addEventListener("change", onSettingsInteraction);
      input.addEventListener("blur", onSettingsInteraction);
    });

    const checkboxInputs = panel.querySelectorAll("input[type=\"checkbox\"]");
    checkboxInputs.forEach(input => {
      input.addEventListener("change", onSettingsInteraction);
    });

  }

  function loadControlPanel() {
    try {
      runtime.board = getBoardElement() || runtime.board;
      const anchor = runtime.board && runtime.board.parentElement
        ? (runtime.board.parentElement.parentElement || runtime.board.parentElement)
        : document.body;

      const existing = document.getElementById("stf-control-root");
      if (existing) {
        existing.remove();
      }

      ensureStyle();

      const root = document.createElement("div");
      root.id = "stf-control-root";
      root.style.display = runtime.extensionEnabled ? "" : "none";

      const toggle = document.createElement("button");
      toggle.id = "stf-toggle";
      toggle.type = "button";
      toggle.className = "stf-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "STF";

      const panel = document.createElement("div");
      panel.id = "stf-panel";
      panel.className = "stf-panel";
      panel.innerHTML = PANEL_HTML;

      root.appendChild(toggle);
      root.appendChild(panel);
      anchor.appendChild(root);

      toggle.addEventListener("click", () => {
        const open = root.classList.toggle("stf-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });

      bindInputListeners(panel);
      loadSettingsFromStorage();

      runtime.loaded = true;
    } catch (error) {
      ChessBot.logger.error("Failed to load control panel", error);
    }
  }

  ChessBot.ui = ChessBot.ui || {};
  ChessBot.ui.controlPanel = {
    loadControlPanel,
    syncSettingsFromPanel
  };
})();
