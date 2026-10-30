"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const adapter = fs.readFileSync(path.join(__dirname, "../extension/adapters/chesscom-dom.js"), "utf8");
const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function setup() {
  const legalMoves = [{ from: "e2", to: "e4" }];
  const appliedMoves = [];
  const highlights = [];
  const board = {
    game: {
      getFEN: () => FEN,
      getPlayingAs: () => "white",
      getTurn: () => "white",
      getLegalMoves: () => legalMoves,
      move: move => appliedMoves.push(move)
    },
    prepend: node => highlights.push(node)
  };
  const doc = {
    querySelector: selector => selector === "chess-board" ? board : null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {} })
  };
  const context = {
    window: { location: { pathname: "/play/online" } },
    document: doc,
    console: { debug() {}, warn() {} }
  };
  vm.runInNewContext(adapter, context);
  return { dom: context.window.__LC0UnifiedMain.dom, appliedMoves, highlights };
}

test("reads Chess.com state and reports current player turn", () => {
  const { dom } = setup();
  assert.equal(dom.resolveCurrentFen(), FEN);
  assert.equal(dom.getPlayerColor(), "white");
  assert.equal(dom.isMyTurn(), true);
  assert.equal(dom.isLiveGameContext(), true);
});

test("passes legal move through original Chess.com game API", () => {
  const { dom, appliedMoves } = setup();
  assert.equal(dom.movePieceUci("e2e5"), false);
  assert.equal(dom.movePieceUci("e2e4"), true);
  assert.equal(appliedMoves.length, 1);
  assert.equal(appliedMoves[0].animate, false);
  assert.equal(appliedMoves[0].userGenerated, true);
});

test("highlights both UCI squares with unified marker", () => {
  const { dom, highlights } = setup();
  dom.highlightMoveUci("e2e4");
  assert.equal(highlights.length, 2);
  assert.equal(highlights[0].className, "highlight square-54 bro");
  assert.equal(highlights[0].style.backgroundColor, "rgb(235, 97, 80)");
});
