"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ext = path.join(__dirname, "../extension");
const read = file => fs.readFileSync(path.join(ext, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));

test("one MV3 manifest targets both sites with isolated platform adapters", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts.length, 3);
  const [common, chesscom, lichess] = manifest.content_scripts;
  assert.equal(common.world, undefined);
  assert.equal(chesscom.world, "MAIN");
  assert.equal(lichess.world, "MAIN");
  assert.deepEqual(chesscom.js, ["adapters/chesscom-dom.js", "main-world.js"]);
  assert.deepEqual(lichess.js, ["adapters/lichess-dom.js", "main-world.js"]);
  assert.ok(common.matches.some(match => match.includes("www.chess.com")));
  assert.ok(common.matches.some(match => match.includes("lichess.org")));
  assert.ok(chesscom.matches.every(match => !match.includes("lichess.org")));
  assert.ok(lichess.matches.every(match => !match.includes("chess.com")));
  for (const script of manifest.content_scripts) {
    for (const file of script.js) assert.ok(fs.existsSync(path.join(ext, file)), file);
  }
});

test("shared bridge storage keeps per-platform settings separated", async () => {
  const values = new Map();
  for (const hostname of ["www.chess.com", "lichess.org"]) {
    const context = {
      location: { hostname },
      window: {},
      chrome: {
        storage: {
          local: {
            get: async keys => Object.fromEntries(keys.map(key => [key, values.get(key)])),
            set: async obj => Object.entries(obj).forEach(([key, val]) => values.set(key, val))
          }
        }
      }
    };
    vm.runInNewContext(read("core/bridge-api.js"), context);
    const bridge = context.window.ChessBot.bridge;
    await bridge.storageSet({ autoRun: hostname === "lichess.org" });
    const stored = await bridge.storageGet(["autoRun"]);
    assert.equal(stored.autoRun, hostname === "lichess.org");
  }
  assert.equal(values.get("platform.chesscom.autoRun"), false);
  assert.equal(values.get("platform.lichess.autoRun"), true);
});

test("MAIN-world requests preserve synchronous Chess.com and async Lichess moves", async () => {
  const moveMethods = [() => true, () => Promise.resolve(true)];
  for (const movePieceUci of moveMethods) {
    const handlers = new Map();
    const window = {
      __LC0UnifiedMain: {
        dom: {
          getBoardElement: () => ({}),
          resolveCurrentFen: () => "example-fen",
          isMyTurn: () => true,
          getPlayerColor: () => "white",
          isLiveGameContext: () => true,
          movePieceUci,
          highlightMoveUci() {},
          clearHighlights() {}
        }
      },
      addEventListener(type, fn) { handlers.set(type, fn); },
      dispatchEvent(event) { handlers.get(event.type)?.(event); }
    };
    class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options.detail; }
    }
    vm.runInNewContext(read("main-world.js"), { window, CustomEvent, Promise, Error });
    const responses = [];
    window.addEventListener("lc0u-page-response", event => responses.push(event.detail));
    window.dispatchEvent(new CustomEvent("lc0u-page-request", {
      detail: { requestId: "move-1", action: "MOVE", move: "e2e4" }
    }));
    for (let i = 0; i < 3; i++) await Promise.resolve();
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].result.applied, true);
  }
});

test("page request event namespace and UI root do not collide with standalone extensions", () => {
  assert.ok(read("main-world.js").includes("lc0u-page-request"));
  assert.ok(read("core/bridge-api.js").includes("lc0u-page-request"));
  assert.ok(read("ui/control-panel.js").includes("lc0u-control-root"));
  assert.ok(read("automation/scheduler.js").includes("lc0u-control-root"));
});

test("both sites use the same popup and host identity", () => {
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.ok(read("background.js").includes("com.lc0bot.unifiedhost"));
  assert.ok(read("popup.js").includes("platform."));
  assert.ok(read("ui/eval-bar.js").includes("#board-layout-evaluation"));
  assert.ok(read("ui/eval-bar.js").includes("main.round .round__app"));
});
