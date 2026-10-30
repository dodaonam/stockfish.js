"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.join(__dirname, "../extension");
const read = name => fs.readFileSync(path.join(extensionRoot, name), "utf8");

function createStorageBridge(hostname, items = new Map()) {
  const local = {
    get: async keys => Object.fromEntries(keys.filter(key => items.has(key)).map(key => [key, items.get(key)])),
    set: async values => { for (const [key, value] of Object.entries(values)) items.set(key, value); }
  };
  const context = { location: { hostname }, window: {}, chrome: { storage: { local } } };
  vm.runInNewContext(read("core/bridge-api.js"), context);
  return { bridge: context.window.ChessBot.bridge, items };
}

test("fresh extension retains default search settings when storage keys are absent", async () => {
  for (const hostname of ["www.chess.com", "lichess.org"]) {
    const { bridge } = createStorageBridge(hostname);
    const stored = await bridge.storageGet(["autoRun", "goMovetimeSec", "goNodes"]);
    assert.deepEqual(Object.keys(stored), []);
    const defaults = { autoRun: false, goMovetimeSec: 0.01, goNodes: 10000 };
    assert.equal({ ...defaults, ...stored }.goMovetimeSec, 0.01);
    assert.equal({ ...defaults, ...stored }.goNodes, 10000);
  }
});

test("partially stored settings do not replace unrelated defaults with undefined", async () => {
  const { bridge, items } = createStorageBridge("lichess.org");
  await bridge.storageSet({ autoRun: true });
  const stored = await bridge.storageGet(["autoRun", "goMovetimeSec", "goNodes"]);
  assert.deepEqual(Object.keys(stored), ["autoRun"]);
  assert.equal(stored.autoRun, true);
  assert.equal(Object.hasOwn(stored, "goNodes"), false);
  assert.equal(items.has("platform.chesscom.autoRun"), false);
});

test("rapid keyboard setting changes persist together after debounce", async () => {
  const timers = new Map();
  const saved = [];
  let sequence = 0;
  const state = { runtime: { uiHidden: false }, settings: { autoRun: false, showEvalBar: false }, config: {} };
  const chessBot = {
    state,
    logger: { warn() {} },
    bridge: { storageSet: async values => { saved.push({ ...values }); } },
    ui: {}
  };
  const context = {
    window: { ChessBot: chessBot },
    location: { hostname: "lichess.org" },
    document: { getElementById: () => null },
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(read("ui/control-panel.js"), context);
  chessBot.ui.controlPanel.setSetting("autoRun", true);
  chessBot.ui.controlPanel.setSetting("showEvalBar", true);
  assert.equal(timers.size, 1);
  for (const callback of timers.values()) callback();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], { autoRun: true, showEvalBar: true });
});

test("storage changes synchronize same-site tabs but do not cross platforms", () => {
  const updates = [];
  let storageListener;
  const context = {
    window: { ChessBot: { ui: { controlPanel: {
      applyExternalSettings(values) { updates.push({ ...values }); }
    } } } },
    location: { hostname: "lichess.org" },
    document: { readyState: "loading", addEventListener() {} },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: { onChanged: { addListener(callback) { storageListener = callback; } } }
    }
  };
  vm.runInNewContext(read("content.js"), context);
  assert.equal(typeof storageListener, "function");
  storageListener({
    "platform.chesscom.autoRun": { newValue: false },
    "platform.lichess.autoRun": { newValue: true },
    "platform.lichess.goNodes": { newValue: 2048 }
  }, "local");
  assert.deepEqual(updates, [{ autoRun: true, goNodes: 2048 }]);
  storageListener({ "platform.lichess.autoMove": { newValue: true } }, "sync");
  assert.equal(updates.length, 1);
});

test("late LC0 response cannot move or highlight after Auto Run is disabled", async () => {
  const pendingTimers = [];
  let waiter = null;
  let respondBestmove = null;
  let moveCount = 0;
  let highlightCount = 0;
  const runtime = {
    extensionEnabled: true, loaded: false, inFlightRequestId: null,
    lastRequestedAnalysisKey: null, pendingDueAt: 0, evalInFlightId: null,
    lastEvaluationKey: null, highlightForFen: null
  };
  const settings = {
    autoRun: true, autoMove: true, showEvalBar: false,
    searchMode: "movetime", goMovetimeSec: 0.01, goNodes: 10000,
    randomDelayMinSec: 0, randomDelayMaxSec: 0
  };
  const pageState = { boardAvailable: true, fen: "sample-fen", isMyTurn: true, isLiveGame: true, playerColor: "white" };
  const chessBot = {
    state: {
      config: { DEFAULT_RANDOM_DELAY_MIN_SEC: 0, DEFAULT_RANDOM_DELAY_MAX_SEC: 0, LOOP_INTERVAL_MS: 120, STOCKFISH_EVAL_DEPTH: 11 },
      runtime, settings, evaluationState: {}
    },
    ui: { controlPanel: { loadControlPanel() { runtime.loaded = true; }, syncSettingsFromPanel() {} } },
    logger: { warn() {}, debug() {}, error() {}, info() {} },
    bridge: {
      makeRequestId: () => "bestmove-test",
      getPageState: async () => pageState,
      requestBestMove: () => new Promise(resolve => { respondBestmove = resolve; }),
      movePieceUci: async () => { moveCount++; return { applied: true }; },
      highlightMoveUci: async () => { highlightCount++; },
      clearHighlights: async () => {}
    }
  };
  const context = {
    window: { ChessBot: chessBot },
    document: { getElementById: () => null },
    setInterval(callback) { waiter = callback; return 1; },
    clearInterval() {},
    setTimeout(callback) { pendingTimers.push(callback); return pendingTimers.length; }
  };
  vm.runInNewContext(read("automation/scheduler.js"), context);
  chessBot.scheduler.start();
  await waiter();
  for (let i = 0; i < 30 && !respondBestmove; i++) {
    if (pendingTimers.length) pendingTimers.shift()();
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(typeof respondBestmove, "function", "scheduler must reach a pending LC0 request");
  settings.autoRun = false;
  respondBestmove({ ok: true, result: { bestmove: "e2e4" } });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(moveCount, 0);
  assert.equal(highlightCount, 0);
});
