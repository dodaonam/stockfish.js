(function() {
  "use strict";

  const ChessBot = window.ChessBot;
  const { runtime, settings, config } = ChessBot.state;

  const STORAGE_KEYS = [
    "autoRun",
    "autoMove",
    "goMovetimeSec",
    "randomDelayMinSec",
    "randomDelayMaxSec",
    "searchMode"
  ];

  const PANEL_STYLE = `
#lc0-control-root{position:fixed;bottom:20px;right:20px;z-index:2147483646;font-family:'Segoe UI',Roboto,sans-serif;}
#lc0-control-root .lc0-toggle{width:56px;height:56px;border-radius:50%;border:none;background:#3f8f2d;color:#fff;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 10px 22px rgba(0,0,0,.28);}
#lc0-control-root .lc0-panel{position:absolute;right:0;bottom:70px;width:320px;max-width:calc(100vw - 32px);background:#fff;border-radius:14px;box-shadow:0 14px 30px rgba(0,0,0,.25);padding:14px;opacity:0;pointer-events:none;transform:translateY(12px) scale(.98);transition:opacity .15s ease,transform .15s ease;}
#lc0-control-root.lc0-open .lc0-panel{opacity:1;pointer-events:auto;transform:translateY(0) scale(1);}
#lc0-control-root .lc0-row{display:flex;align-items:center;gap:8px;margin:8px 0;}
#lc0-control-root .lc0-row.lc0-col{flex-direction:column;align-items:flex-start;}
#lc0-control-root label{font-size:13px;color:#1f2937;}
#lc0-control-root input[type="number"],#lc0-control-root select{width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;}
#lc0-control-root .lc0-title{font-size:14px;font-weight:700;margin:0 0 6px;}
#lc0-control-root .lc0-sub{margin:0 0 4px;color:#4b5563;font-size:12px;}
`;

  const PANEL_HTML = `
<div class="lc0-body">
  <p class="lc0-title">LC0 Settings</p>
  <p class="lc0-sub">All time fields are in seconds.</p>

  <div class="lc0-row">
    <input type="checkbox" id="autoRun">
    <label for="autoRun">Auto Run</label>
  </div>

  <div class="lc0-row">
    <input type="checkbox" id="autoMove">
    <label for="autoMove">Auto Move</label>
  </div>

  <div class="lc0-row lc0-col">
    <label for="goMovetimeSec">Go Move Time (s)</label>
    <input type="number" id="goMovetimeSec" step="0.05" value="0.5">
  </div>

  <div class="lc0-row lc0-col">
    <label for="randomDelayMinSec">Random Delay Min (s)</label>
    <input type="number" id="randomDelayMinSec" step="0.1" value="0.1">
  </div>

  <div class="lc0-row lc0-col">
    <label for="randomDelayMaxSec">Random Delay Max (s)</label>
    <input type="number" id="randomDelayMaxSec" step="0.1" value="0.6">
  </div>

  <div class="lc0-row lc0-col">
    <label for="searchMode">Search Mode</label>
    <select id="searchMode">
      <option value="classic">classic</option>
      <option value="policyhead">policyhead</option>
      <option value="valuehead">valuehead</option>
    </select>
  </div>
</div>
`;

  function ensureStyle() {
    if (document.getElementById("lc0-control-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "lc0-control-style";
    style.textContent = PANEL_STYLE;
    document.head.appendChild(style);
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
      autoRun: byId("autoRun")?.checked ?? baseSettings.autoRun,
      autoMove: byId("autoMove")?.checked ?? baseSettings.autoMove,
      goMovetimeSec: readNumberOrFallback(byId("goMovetimeSec")?.value, baseSettings.goMovetimeSec),
      randomDelayMinSec: readNumberOrFallback(byId("randomDelayMinSec")?.value, baseSettings.randomDelayMinSec),
      randomDelayMaxSec: readNumberOrFallback(byId("randomDelayMaxSec")?.value, baseSettings.randomDelayMaxSec),
      searchMode: byId("searchMode")?.value ?? baseSettings.searchMode
    };
  }

  function sanitizeSettings(input) {
    const normalized = {
      autoRun: !!input.autoRun,
      autoMove: !!input.autoMove,
      goMovetimeSec: clamp(Number(input.goMovetimeSec), config.MOVETIME_SEC_MIN, config.MOVETIME_SEC_MAX),
      randomDelayMinSec: clamp(Number(input.randomDelayMinSec), config.RANDOM_DELAY_SEC_MIN, config.RANDOM_DELAY_SEC_MAX),
      randomDelayMaxSec: clamp(Number(input.randomDelayMaxSec), config.RANDOM_DELAY_SEC_MIN, config.RANDOM_DELAY_SEC_MAX),
      searchMode: ["classic", "policyhead", "valuehead"].includes(input.searchMode) ? input.searchMode : config.DEFAULT_SEARCH_MODE
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

    const autoRun = byId("autoRun");
    const autoMove = byId("autoMove");
    const goMovetimeSec = byId("goMovetimeSec");
    const randomDelayMinSec = byId("randomDelayMinSec");
    const randomDelayMaxSec = byId("randomDelayMaxSec");
    const searchMode = byId("searchMode");

    if (autoRun) autoRun.checked = safe.autoRun;
    if (autoMove) autoMove.checked = safe.autoMove;
    if (goMovetimeSec) goMovetimeSec.value = String(safe.goMovetimeSec);
    if (randomDelayMinSec) randomDelayMinSec.value = String(safe.randomDelayMinSec);
    if (randomDelayMaxSec) randomDelayMaxSec.value = String(safe.randomDelayMaxSec);
    if (searchMode) searchMode.value = safe.searchMode;

    Object.assign(settings, safe);
  }

  async function persistSettings(nextSettings) {
    try {
      await ChessBot.bridge.storageSet(nextSettings);
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
        ...stored
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

    const selectInputs = panel.querySelectorAll("select");
    selectInputs.forEach(input => {
      input.addEventListener("change", onSettingsInteraction);
    });
  }

  function loadControlPanel() {
    try {
      runtime.board = ChessBot.dom.getBoardElement() || runtime.board;
      const anchor = runtime.board && runtime.board.parentElement
        ? (runtime.board.parentElement.parentElement || runtime.board.parentElement)
        : document.body;

      const existing = ChessBot.dom.getControlPanelRoot();
      if (existing) {
        existing.remove();
      }

      ensureStyle();

      const root = document.createElement("div");
      root.id = "lc0-control-root";

      const toggle = document.createElement("button");
      toggle.id = "lc0-toggle";
      toggle.type = "button";
      toggle.className = "lc0-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "LC0";

      const panel = document.createElement("div");
      panel.id = "lc0-panel";
      panel.className = "lc0-panel";
      panel.innerHTML = PANEL_HTML;

      root.appendChild(toggle);
      root.appendChild(panel);
      anchor.appendChild(root);

      toggle.addEventListener("click", () => {
        const open = root.classList.toggle("lc0-open");
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
