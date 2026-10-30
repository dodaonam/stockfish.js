(function() {
  "use strict";

  const ChessBot = window.ChessBot;
  const { runtime, settings, config } = ChessBot.state;

  const STORAGE_KEYS = [
    "autoRun",
    "autoMove",
    "showEvalBar",
    "searchMode",
    "goMovetimeSec",
    "goNodes",
    "randomDelayMinSec",
    "randomDelayMaxSec"
  ];

  const PANEL_STYLE = `
#lc0u-control-root{position:fixed;bottom:20px;right:20px;z-index:2147483646;font-family:'Segoe UI',Roboto,sans-serif;}
#lc0u-control-root.lc0u-ui-hidden{display:none!important;}
#lc0u-control-root .lc0u-toggle{width:56px;height:56px;border-radius:50%;border:none;background:#3f8f2d;color:#fff;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 10px 22px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;text-align:center;line-height:1;padding:0;box-sizing:border-box;}
#lc0u-control-root .lc0u-panel{position:absolute;right:0;bottom:70px;width:320px;max-width:calc(100vw - 32px);background:#fff;border-radius:14px;box-shadow:0 14px 30px rgba(0,0,0,.25);padding:14px;opacity:0;pointer-events:none;transform:translateY(12px) scale(.98);transition:opacity .15s ease,transform .15s ease;}
#lc0u-control-root.lc0u-open .lc0u-panel{opacity:1;pointer-events:auto;transform:translateY(0) scale(1);}
#lc0u-control-root .lc0u-row{display:flex;align-items:center;gap:8px;margin:8px 0;}
#lc0u-control-root .lc0u-row.lc0u-col{flex-direction:column;align-items:flex-start;}
#lc0u-control-root label{font-size:13px;color:#1f2937;}
#lc0u-control-root input[type="number"],#lc0u-control-root select{width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;}
#lc0u-control-root .lc0u-title{font-size:14px;font-weight:700;margin:0 0 6px;}
#lc0u-control-root .lc0u-sub{margin:0 0 4px;color:#4b5563;font-size:12px;}
`;

  const PANEL_HTML = `
<div class="lc0u-body">
  <p class="lc0u-title">LC0 Settings</p>
  <p class="lc0u-sub">All time fields are in seconds.</p>

  <div class="lc0u-row">
    <input type="checkbox" id="autoRun">
    <label for="autoRun">Auto Run</label>
  </div>

  <div class="lc0u-row">
    <input type="checkbox" id="autoMove">
    <label for="autoMove">Auto Move</label>
  </div>

  <div class="lc0u-row">
    <input type="checkbox" id="showEvalBar">
    <label for="showEvalBar">Show Evaluation Bar</label>
  </div>

  <div class="lc0u-row lc0u-col">
    <label for="searchMode">Search Mode</label>
    <select id="searchMode">
      <option value="movetime">Move Time</option>
      <option value="nodes">Nodes</option>
    </select>
  </div>

  <div class="lc0u-row lc0u-col" id="movetimeSettings">
    <label for="goMovetimeSec">Go Move Time (s)</label>
    <input type="number" id="goMovetimeSec" step="0.001" value="0.01" min="0.001" max="10">
  </div>

  <div class="lc0u-row lc0u-col" id="nodesSettings">
    <label for="goNodes">Go Nodes</label>
    <input type="number" id="goNodes" step="1" value="10000" min="1" max="10000">
  </div>

  <div class="lc0u-row lc0u-col">
    <label for="randomDelayMinSec">Random Delay Min (s)</label>
    <input type="number" id="randomDelayMinSec" step="0.1" value="0" min="0" max="30">
  </div>

  <div class="lc0u-row lc0u-col">
    <label for="randomDelayMaxSec">Random Delay Max (s)</label>
    <input type="number" id="randomDelayMaxSec" step="0.1" value="0" min="0" max="30">
  </div>

</div>
`;

  function ensureStyle() {
    if (document.getElementById("lc0u-control-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "lc0u-control-style";
    style.textContent = PANEL_STYLE;
    document.head.appendChild(style);
  }

  function getBoardElement() {
    return location.hostname === "lichess.org"
      ? document.querySelector("main.round .round__app .cg-wrap cg-board, main.round cg-board")
      : document.querySelector("chess-board, wc-chess-board");
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
      showEvalBar: byId("showEvalBar")?.checked ?? baseSettings.showEvalBar,
      searchMode: byId("searchMode")?.value ?? baseSettings.searchMode,
      goMovetimeSec: readNumberOrFallback(byId("goMovetimeSec")?.value, baseSettings.goMovetimeSec),
      goNodes: readNumberOrFallback(byId("goNodes")?.value, baseSettings.goNodes),
      randomDelayMinSec: readNumberOrFallback(byId("randomDelayMinSec")?.value, baseSettings.randomDelayMinSec),
      randomDelayMaxSec: readNumberOrFallback(byId("randomDelayMaxSec")?.value, baseSettings.randomDelayMaxSec)
    };
  }

  function sanitizeSettings(input) {
    const normalized = {
      autoRun: !!input.autoRun,
      autoMove: !!input.autoMove,
      showEvalBar: !!input.showEvalBar,
      searchMode: input.searchMode === "nodes" ? "nodes" : "movetime",
      goMovetimeSec: clamp(Number(input.goMovetimeSec), config.MOVETIME_SEC_MIN, config.MOVETIME_SEC_MAX),
      goNodes: Math.round(clamp(Number(input.goNodes), config.NODES_MIN, config.NODES_MAX)),
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

    const autoRun = byId("autoRun");
    const autoMove = byId("autoMove");
    const showEvalBar = byId("showEvalBar");
    const searchMode = byId("searchMode");
    const goMovetimeSec = byId("goMovetimeSec");
    const goNodes = byId("goNodes");
    const movetimeSettings = byId("movetimeSettings");
    const nodesSettings = byId("nodesSettings");
    const randomDelayMinSec = byId("randomDelayMinSec");
    const randomDelayMaxSec = byId("randomDelayMaxSec");

    if (autoRun) autoRun.checked = safe.autoRun;
    if (autoMove) autoMove.checked = safe.autoMove;
    if (showEvalBar) showEvalBar.checked = safe.showEvalBar;
    if (searchMode) searchMode.value = safe.searchMode;
    if (goMovetimeSec) goMovetimeSec.value = String(safe.goMovetimeSec);
    if (goNodes) goNodes.value = String(safe.goNodes);
    if (movetimeSettings) movetimeSettings.style.display = safe.searchMode === "movetime" ? "flex" : "none";
    if (nodesSettings) nodesSettings.style.display = safe.searchMode === "nodes" ? "flex" : "none";
    if (randomDelayMinSec) randomDelayMinSec.value = String(safe.randomDelayMinSec);
    if (randomDelayMaxSec) randomDelayMaxSec.value = String(safe.randomDelayMaxSec);

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
  let pendingSettings = {};
  let persistQueue = Promise.resolve();
  function schedulePersist(nextSettings) {
    // Keyboard shortcuts supply partial updates: coalesce them instead of
    // cancelling an earlier change during the 120 ms debounce period.
    Object.assign(pendingSettings, nextSettings);
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const snapshot = pendingSettings;
      pendingSettings = {};
      // Serialize writes so a previous slow storage.set cannot win a race.
      persistQueue = persistQueue.then(() => persistSettings(snapshot));
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

    byId("searchMode")?.addEventListener("change", onSettingsInteraction);

  }

  function loadControlPanel() {
    try {
      runtime.board = getBoardElement() || runtime.board;
      const anchor = location.hostname === "lichess.org"
        ? document.body
        : (runtime.board?.parentElement?.parentElement ||
           runtime.board?.parentElement || document.body);

      const existing = document.getElementById("lc0u-control-root");
      if (existing) {
        existing.remove();
      }

      ensureStyle();

      const root = document.createElement("div");
      root.id = "lc0u-control-root";
      root.style.display = runtime.extensionEnabled ? "" : "none";
      root.classList.toggle("lc0u-ui-hidden", runtime.uiHidden);

      const toggle = document.createElement("button");
      toggle.id = "lc0u-toggle";
      toggle.type = "button";
      toggle.className = "lc0u-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "LC0";

      const panel = document.createElement("div");
      panel.id = "lc0u-panel";
      panel.className = "lc0u-panel";
      panel.innerHTML = PANEL_HTML;

      root.appendChild(toggle);
      root.appendChild(panel);
      anchor.appendChild(root);

      if (!runtime.uiHidden && runtime.panelWasOpenBeforeHide) {
        root.classList.add("lc0u-open");
        toggle.setAttribute("aria-expanded", "true");
      }

      toggle.addEventListener("click", () => {
        const open = root.classList.toggle("lc0u-open");
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
    syncSettingsFromPanel,
    applyExternalSettings(changes) {
      if (changes && Object.keys(changes).length) {
        applySettingsToInputs({ ...settings, ...changes });
      }
    },
    setSetting(name, value) {
      if (name !== "autoRun" && name !== "showEvalBar") {
        return false;
      }
      const nextValue = !!value;
      settings[name] = nextValue;
      const input = byId(name);
      if (input) {
        input.checked = nextValue;
      }
      schedulePersist({ [name]: nextValue });
      return nextValue;
    },
    setPanelOpen(open) {
      const root = document.getElementById("lc0u-control-root");
      const toggle = document.getElementById("lc0u-toggle");
      if (!root || runtime.uiHidden) {
        return false;
      }
      const nextOpen = open === true;
      root.classList.toggle("lc0u-open", nextOpen);
      toggle?.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      return nextOpen;
    },
    togglePanel() {
      const root = document.getElementById("lc0u-control-root");
      if (!root || runtime.uiHidden) {
        return false;
      }
      return this.setPanelOpen(!root.classList.contains("lc0u-open"));
    },
    setUiHidden(hidden) {
      const root = document.getElementById("lc0u-control-root");
      if (hidden === runtime.uiHidden) {
        return runtime.uiHidden;
      }
      if (hidden) {
        runtime.panelWasOpenBeforeHide = !!root?.classList.contains("lc0u-open");
        runtime.uiHidden = true;
        root?.classList.remove("lc0u-open");
        root?.classList.add("lc0u-ui-hidden");
        root?.querySelector(".lc0u-toggle")?.setAttribute("aria-expanded", "false");
      } else {
        runtime.uiHidden = false;
        root?.classList.remove("lc0u-ui-hidden");
        this.setPanelOpen(runtime.panelWasOpenBeforeHide);
      }
      return runtime.uiHidden;
    }
  };
})();
