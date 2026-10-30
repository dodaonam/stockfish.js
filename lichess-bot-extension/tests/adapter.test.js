"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const adapter = fs.readFileSync(
  path.join(__dirname, "../extension/adapters/lichess-dom.js"), "utf8"
);
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR";
const E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR";

async function setup({ spectator = false, variant = "standard", color = "white" } = {}) {
  const callbacks = [];
  const draws = [];
  const board = {
    closest: () => ({ classList: { contains: () => false } }),
    appendChild: node => draws.push(node)
  };
  const doc = {
    querySelector: () => board,
    querySelectorAll: () => draws,
    createElement: () => ({ style: {}, setAttribute() {}, remove() {} })
  };
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.listeners = {}; this.sent = []; }
    send(value) { this.sent.push(JSON.parse(value)); }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    emit(type, data) {
      for (const callback of this.listeners[type] || []) callback({ data: JSON.stringify(data) });
    }
  }
  const window = { WebSocket: Socket };
  const response = {
    game: { fen: START, variant: { key: variant }, status: { name: "started" } },
    player: { color, spectator },
    steps: [{ ply: 0, fen: START }],
    possibleMoves: "e2e3e4 d2d3d4"
  };
  let fetchCount = 0;
  const ctx = {
    window,
    document: doc,
    location: { href: "https://lichess.org/game/12345678", pathname: "/game/12345678" },
    URL,
    console: { warn() {} },
    fetch: async (_url, opts) => {
      assert.equal(opts.headers.Accept, "application/web.lichess+json");
      fetchCount++;
      return { ok: true, json: async () => response };
    },
    setTimeout(fn, ms) { callbacks.push({ fn, ms }); return callbacks.length; },
    clearTimeout() {}
  };
  vm.runInNewContext(adapter, ctx);
  const socket = new window.WebSocket("wss://socket.lichess.org/play/12345678abcd/v6");
  for (const callback of callbacks.filter(t => t.ms < 1000)) callback.fn();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return { dom: window.__LC0BotMain.dom, socket, draws, fetchCount };
}

test("reconstructs standard FEN and tracks turn and move confirmation", async () => {
  const { dom, socket, fetchCount } = await setup();
  assert.equal(fetchCount, 1);
  assert.equal(dom.resolveCurrentFen(), START + " w KQkq - 0 1");
  assert.equal(dom.isMyTurn(), true);
  assert.equal(dom.movePieceUci("e2e5"), false);
  assert.equal(dom.movePieceUci("e2e4"), true);
  assert.equal(dom.isMyTurn(), false);
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].d.u, "e2e4");
  socket.emit("message", { t: "move", d: { ply: 1, fen: E4, uci: "e2e4", san: "e4", dests: "e7e5e6" } });
  assert.equal(dom.resolveCurrentFen(), E4 + " b KQkq e3 0 1");
  socket.emit("message", { t: "move", d: { ply: 2, fen: E5, uci: "e7e5", san: "e5", dests: "g1f3h3" } });
  assert.equal(dom.resolveCurrentFen(), E5 + " w KQkq e6 0 2");
  assert.equal(dom.isMyTurn(), true);
});

test("never sends a move in spectator or nonstandard games", async () => {
  for (const opts of [{ spectator: true }, { variant: "chess960" }]) {
    const { dom, socket } = await setup(opts);
    assert.equal(dom.isMyTurn(), false);
    assert.equal(dom.isLiveGameContext(), false);
    assert.equal(dom.movePieceUci("e2e4"), false);
    assert.equal(socket.sent.length, 0);
  }
});

test("highlights source and destination without changing board pieces", async () => {
  const { dom, draws } = await setup();
  dom.highlightMoveUci("e2e4");
  assert.equal(draws.length, 2);
  assert.match(draws[0].style.cssText, /left:50%;top:50%/);
  assert.match(draws[1].style.cssText, /left:50%;top:75%/);
});
