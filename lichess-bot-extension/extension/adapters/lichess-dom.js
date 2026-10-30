(function () {
  "use strict";

  // Runs in MAIN world. Lichess' round data and WebSocket protocol are
  // platform-specific; the scheduler and LC0 UI remain shared with Chess.com.
  const main = window.__LC0BotMain = window.__LC0BotMain || {};
  const runtime = main.runtime = main.runtime || {};
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
  const SQUARE = /^[a-h][1-8]$/;
  const HIGHLIGHT_ATTR = "data-lc0-highlight";
  const sockets = new Map();
  let round = null;
  let bootstrapTimer = null;
  let bootstrapGeneration = 0;
  let activeFullId = null;

  function getBoardElement() {
    return document.querySelector("main.round .round__app .cg-wrap cg-board, main.round cg-board");
  }

  function boardOrientation() {
    const wrap = getBoardElement()?.closest(".cg-wrap");
    return wrap?.classList.contains("orientation-black") ? "black" : "white";
  }

  function findSocketMeta(value) {
    try {
      const path = new URL(String(value), location.href).pathname;
      const match = path.match(/\/play\/([a-zA-Z0-9]{12})\/v\d+$/);
      return match ? { fullId: match[1], gameId: match[1].slice(0, 8) } : null;
    } catch (_) {
      return null;
    }
  }

  function pieceAt(placement, square) {
    if (!SQUARE.test(square)) return null;
    const rank = placement.split("/")[8 - Number(square[1])];
    if (!rank) return null;
    let file = 0;
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else {
        if (file === square.charCodeAt(0) - 97) return ch;
        file += 1;
      }
    }
    return null;
  }

  function normalizePlacement(fen) {
    const placement = String(fen || "").trim().split(/\s+/)[0];
    const ranks = placement.split("/");
    if (ranks.length !== 8 || !ranks.every(rank => {
      if (!/^[prnbqkPRNBQK1-8]+$/.test(rank)) return false;
      return [...rank].reduce((n, ch) => n + (/[1-8]/.test(ch) ? Number(ch) : 1), 0) === 8;
    })) return null;
    return placement;
  }

  function dropCastling(rights, letters) {
    for (const letter of letters) rights = rights.replace(letter, "");
    return rights;
  }

  function updateCastling(rights, uci) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    if (from === "e1") rights = dropCastling(rights, "KQ");
    if (from === "e8") rights = dropCastling(rights, "kq");
    if (from === "a1" || to === "a1") rights = dropCastling(rights, "Q");
    if (from === "h1" || to === "h1") rights = dropCastling(rights, "K");
    if (from === "a8" || to === "a8") rights = dropCastling(rights, "q");
    if (from === "h8" || to === "h8") rights = dropCastling(rights, "k");
    return rights;
  }

  function deriveFen(session) {
    const steps = session.steps;
    if (!steps.length) return null;
    const last = steps[steps.length - 1];
    const placement = normalizePlacement(last.fen || session.gameFen);
    if (!placement) return null;
    const ply = Number(last.ply);
    if (!Number.isInteger(ply) || ply < 0) return null;
    const side = ply % 2 === 0 ? "w" : "b";
    const initialFields = String(session.initialFen || START_FEN).trim().split(/\s+/);
    const initialPly = (Math.max(1, Number(initialFields[5]) || 1) - 1) * 2 +
      (initialFields[1] === "b" ? 1 : 0);
    if (Number(steps[0].ply) !== initialPly) return null;
    let castling = /^[KQkq]+$/.test(initialFields[2]) ? initialFields[2] : "";
    let halfmove = Number(initialFields[4]) || 0;
    let enPassant = "-";

    // RoundStep.fen is piece placement, not a complete six-field UCI FEN.
    // Reconstruct the rights/counters from the authoritative move history.
    for (let i = 1; i < steps.length; i += 1) {
      const step = steps[i];
      const move = String(step.uci || "").toLowerCase();
      if (!UCI.test(move)) continue;
      castling = updateCastling(castling, move);
      const preceding = normalizePlacement(steps[i - 1].fen);
      const sourcePiece = preceding && pieceAt(preceding, move.slice(0, 2));
      const isPawn = sourcePiece?.toLowerCase() === "p";
      const capture = String(step.san || "").includes("x") ||
        (!!preceding && !!pieceAt(preceding, move.slice(2, 4)));
      halfmove = isPawn || capture ? 0 : halfmove + 1;
    }

    const lastMove = String(last.uci || "").toLowerCase();
    if (UCI.test(lastMove)) {
      const from = lastMove.slice(0, 2);
      const to = lastMove.slice(2, 4);
      const pawn = pieceAt(placement, to);
      if (from[0] === to[0] &&
          ((from[1] === "2" && to[1] === "4" && pawn === "P") ||
           (from[1] === "7" && to[1] === "5" && pawn === "p"))) {
        enPassant = from[0] + (from[1] === "2" ? "3" : "6");
      }
    }
    return [placement, side, castling || "-", enPassant, String(halfmove),
      String(Math.floor(ply / 2) + 1)].join(" ");
  }

  function parseDests(encoded) {
    const map = new Map();
    if (typeof encoded === "string") {
      for (const block of encoded.split(" ")) {
        if (SQUARE.test(block.slice(0, 2))) {
          map.set(block.slice(0, 2), block.slice(2).match(/.{2}/g) || []);
        }
      }
    } else if (encoded && typeof encoded === "object") {
      for (const [from, targets] of Object.entries(encoded)) {
        if (SQUARE.test(from) && typeof targets === "string") {
          map.set(from, targets.match(/.{2}/g) || []);
        }
      }
    }
    return map;
  }

  function isActiveStatus(status) {
    return status === "started" || status === "created";
  }

  function clearPending(session, confirmed = false) {
    if (!session) return;
    clearTimeout(session.pendingTimer);
    const resolve = session.pendingResolve;
    session.pendingTimer = null;
    session.pendingMove = null;
    session.pendingResolve = null;
    if (resolve) resolve(confirmed);
  }

  function markPending(session, move, resolve = null) {
    clearPending(session);
    session.pendingMove = move;
    session.pendingResolve = resolve;
    session.pendingTimer = setTimeout(() => {
      if (round !== session || !session.pendingMove) return;
      clearPending(session);
      scheduleBootstrap(session.fullId);
    }, 3500);
  }

  async function bootstrap(fullId) {
    const generation = ++bootstrapGeneration;
    if (!fullId || !sockets.has(fullId)) return;
    try {
      const response = await fetch("/game/" + encodeURIComponent(fullId), {
        credentials: "same-origin",
        cache: "no-cache",
        headers: { Accept: "application/web.lichess+json", "X-Requested-With": "XMLHttpRequest" }
      });
      if (!response.ok) throw new Error("Lichess round bootstrap HTTP " + response.status);
      const data = await response.json();
      if (generation !== bootstrapGeneration || activeFullId !== fullId) return;
      const steps = Array.isArray(data.steps) ? data.steps.slice() : [];
      if (!steps.length || !data.game || !data.player) {
        throw new Error("Lichess round bootstrap returned incomplete data");
      }
      const session = {
        fullId,
        socket: sockets.get(fullId),
        steps,
        gameFen: data.game.fen,
        initialFen: data.game.initialFen || START_FEN,
        playerColor: data.player.color,
        variant: data.game.variant?.key,
        spectator: !!data.player.spectator,
        status: data.game.status?.name || "started",
        possibleMoves: parseDests(data.possibleMoves),
        pendingMove: null,
        pendingTimer: null,
        pendingResolve: null
      };
      if (!deriveFen(session)) throw new Error("Unable to reconstruct Lichess FEN");
      clearPending(round);
      round = session;
    } catch (error) {
      if (generation === bootstrapGeneration) {
        console.warn("[LC0 Bot] Lichess bootstrap failed", error);
        clearPending(round);
        round = null;
      }
    }
  }

  function scheduleBootstrap(fullId) {
    if (!fullId) return;
    activeFullId = fullId;
    clearTimeout(bootstrapTimer);
    bootstrapTimer = setTimeout(() => { bootstrap(fullId).catch(console.warn); }, 100);
  }

  function ingestMove(session, move) {
    const ply = Number(move?.ply);
    if (!Number.isInteger(ply) || !normalizePlacement(move.fen) || !UCI.test(String(move.uci || "").toLowerCase())) {
      scheduleBootstrap(session.fullId);
      return;
    }
    const latest = session.steps[session.steps.length - 1];
    const latestPly = Number(latest?.ply);
    if (ply <= latestPly) {
      if (ply < latestPly) scheduleBootstrap(session.fullId);
      clearPending(session);
      return;
    }
    if (ply !== latestPly + 1) {
      scheduleBootstrap(session.fullId);
      return;
    }
    session.steps.push({ ply, fen: move.fen, uci: move.uci, san: move.san });
    session.possibleMoves = parseDests(move.dests);
    if (move.status?.name) session.status = move.status.name;
    const confirmed = session.pendingMove === String(move.uci).toLowerCase();
    clearPending(session, confirmed);
  }

  function ingestMessage(meta, message) {
    if (!message || !meta || meta.fullId !== activeFullId) return;
    if (message.t === "batch" && Array.isArray(message.d)) {
      message.d.forEach(item => ingestMessage(meta, item));
      return;
    }
    if (message.t === "reload" || message.t === "resync") {
      scheduleBootstrap(meta.fullId);
      return;
    }
    if (message.t === "endData") {
      if (round?.fullId === meta.fullId) {
        round.status = "ended";
        clearPending(round);
      }
      return;
    }
    if (message.t === "move" || message.t === "drop") {
      if (round?.fullId === meta.fullId) ingestMove(round, message.d);
      else scheduleBootstrap(meta.fullId);
    }
  }

  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket && !window.__LC0LichessSocketHook) {
    window.__LC0LichessSocketHook = true;
    function TrackingWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      const meta = findSocketMeta(url);
      if (!meta) return socket;
      sockets.set(meta.fullId, socket);
      scheduleBootstrap(meta.fullId);
      const nativeSend = socket.send;
      socket.send = function (data) {
        try {
          if (typeof data === "string") {
            const message = JSON.parse(data);
            if (message.t === "move" || message.t === "drop") {
              if (round?.fullId === meta.fullId) markPending(round, message.d?.u || "move");
            }
          }
        } catch (_) {}
        return nativeSend.apply(this, arguments);
      };
      socket.addEventListener("message", event => {
        try {
          if (typeof event.data === "string" && event.data !== "0") {
            ingestMessage(meta, JSON.parse(event.data));
          }
        } catch (_) {}
      });
      socket.addEventListener("close", () => {
        if (sockets.get(meta.fullId) === socket) sockets.delete(meta.fullId);
      });
      return socket;
    }
    TrackingWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(TrackingWebSocket, NativeWebSocket);
    window.WebSocket = TrackingWebSocket;
  }

  function resolveCurrentFen() {
    return round && round.fullId === activeFullId ? deriveFen(round) : null;
  }

  function getPlayerColor() {
    return round && !round.spectator && ["white", "black"].includes(round.playerColor)
      ? round.playerColor : null;
  }

  function isLiveGameContext() {
    return !!(round && getBoardElement() && round.variant === "standard" &&
      !round.spectator && isActiveStatus(round.status) &&
      /^\/(?:game\/)?[a-zA-Z0-9]{8,12}(?:\/|$)/.test(location.pathname));
  }

  function isMyTurn() {
    if (!isLiveGameContext() || round.pendingMove) return false;
    const ply = Number(round.steps[round.steps.length - 1]?.ply);
    return (ply % 2 === 0 ? "white" : "black") === getPlayerColor();
  }

  function movePieceUci(move) {
    if (!UCI.test(move) || !isMyTurn()) return false;
    const targets = round.possibleMoves.get(move.slice(0, 2)) || [];
    if (!targets.includes(move.slice(2, 4))) return false;
    const socket = sockets.get(round.fullId);
    if (!socket || socket.readyState !== NativeWebSocket.OPEN) return false;
    return new Promise(resolve => {
      try {
        // The official round socket sends {t:"move",d:{u:UCI}}.
        // Do not report success until the authoritative inbound move confirms it.
        socket.send(JSON.stringify({ t: "move", d: { u: move } }));
        markPending(round, move, resolve);
      } catch (error) {
        clearPending(round);
        console.warn("[LC0 Bot] Lichess move request failed", error);
        resolve(false);
      }
    });
  }

  function clearHighlights() {
    document.querySelectorAll("[" + HIGHLIGHT_ATTR + "='1']").forEach(node => node.remove());
  }

  function createHighlight(square) {
    const board = getBoardElement();
    if (!board || !SQUARE.test(square)) return;
    const black = boardOrientation() === "black";
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    const column = black ? 7 - file : file;
    const row = black ? rank : 7 - rank;
    const node = document.createElement("div");
    node.setAttribute(HIGHLIGHT_ATTR, "1");
    node.style.cssText = "position:absolute;pointer-events:none;z-index:2;" +
      "width:12.5%;height:12.5%;left:" + (column * 12.5) +
      "%;top:" + (row * 12.5) + "%;background:rgb(235, 97, 80);opacity:0.68";
    board.appendChild(node);
  }

  function highlightMoveUci(move) {
    if (!UCI.test(move)) return;
    clearHighlights();
    createHighlight(move.slice(2, 4));
    createHighlight(move.slice(0, 2));
  }

  main.dom = {
    getBoardElement,
    resolveCurrentFen,
    getPlayerColor,
    isLiveGameContext,
    isMyTurn,
    movePieceUci,
    highlightMoveUci,
    clearHighlights
  };
})();
