// ==UserScript==
// @name         Lichess Stockfish Coach MVP
// @namespace    lichess-stockfish-coach
// @version      0.1.13
// @description  AI-only Stockfish coach for Lichess with a compact extension-style control panel, move hints, configurable depth, delays, and keyboard shortcuts.
// @match        https://lichess.org/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_ID = 'lichess-stockfish-coach';
    const BRIDGE_SOURCE = '__LICHESS_STOCKFISH_COACH_BRIDGE__';
    const DEPTH_STORAGE_KEY = `${SCRIPT_ID}:analysis-depth`;
    const DELAY_MIN_STORAGE_KEY = `${SCRIPT_ID}:delay-min`;
    const DELAY_MAX_STORAGE_KEY = `${SCRIPT_ID}:delay-max`;

    // Use the exact Stockfish source family from the chess.com script the user provided.
    const STOCKFISH_BASE_URL = 'https://raw.githubusercontent.com/dodaonam/stockfish.js/main/171_single_nnue/';
    const STOCKFISH_MAIN_SCRIPT = 'stockfish-17.1-single-a496a04.js';
    const STOCKFISH_WASM_URL = `${STOCKFISH_BASE_URL}stockfish-17.1-single-a496a04.wasm`;
    // Stockfish 17.1 NNUE build on this source fetches split wasm parts.
    // On Lichess those direct worker fetches are blocked by page CSP, so preload them with GM_xmlhttpRequest.
    // This build uses split wasm parts 0..5. Do not probe non-existent parts because that floods the console with 404 warnings.
    const STOCKFISH_WASM_PART_COUNT = 6;
    const STOCKFISH_WASM_PART_URLS = Array.from(
        { length: STOCKFISH_WASM_PART_COUNT },
        (_, index) => `${STOCKFISH_BASE_URL}stockfish-17.1-single-a496a04-part-${index}.wasm`,
    );
    const STOCKFISH_BOOTSTRAP_PATTERN =
        'a=decodeURIComponent(e[0]||location.origin+location.pathname.replace(/\\.js$/i,".wasm"))';

    const ENGINE_CACHE_DB_NAME = `${SCRIPT_ID}:engine-cache`;
    const ENGINE_CACHE_STORE_NAME = 'files';
    const ENGINE_CACHE_VERSION = 'stockfish-17.1-single-a496a04-v1';

    const CONFIG = {
        multipv: 3,
        defaultDepth: 6,
        minDepth: 1,
        maxDepth: 11,
        engineHashMb: 16,
        engineThreads: 1,
        bootstrapDebounceMs: 250,
        pendingMoveTimeoutMs: 4000,
        overlayRefreshMs: 500,
        strictAiOnly: true,
        standardOnly: true,
        debug: false,
    };


    function evaluateGuardDecision(data = null) {
        let variantKey = null;
        let isStandard = false;
        let isAi = false;
        let isSpectator = false;
        let status = 'waiting';
        let reason = 'Waiting game';

        if (data) {
            variantKey = data?.game?.variant?.key || null;
            isStandard = variantKey === 'standard';
            isAi = Number.isInteger(data?.opponent?.ai) || data?.game?.source === 'ai';
            isSpectator = !!data?.player?.spectator;

            status = 'confirmed_ai';
            reason = 'AI game';

            if (isSpectator) {
                status = 'inactive';
                reason = 'Spectator mode';
            } else if (CONFIG.standardOnly && !isStandard) {
                status = 'inactive';
                reason = `Variant ${variantKey || 'unknown'}`;
            } else if (CONFIG.strictAiOnly && !isAi) {
                status = 'inactive';
                reason = 'Human game';
            }
        }

        const canCoach = true;

        return {
            variantKey,
            isStandard,
            isAi,
            isSpectator,
            status,
            reason,
            canCoach,
            sessionStatus: canCoach ? 'active' : data ? 'inactive' : 'bootstrapping',
        };
    }

    function canUseCoach(session = state.session) {
        return !!session?.guard?.canCoach;
    }

    function clampDepth(value) {
        const depth = Number(value);
        if (!Number.isFinite(depth)) return CONFIG.defaultDepth;
        return Math.max(CONFIG.minDepth, Math.min(CONFIG.maxDepth, Math.round(depth)));
    }

    function loadDepthSetting() {
        try {
            return clampDepth(window.localStorage.getItem(DEPTH_STORAGE_KEY));
        } catch (_) {
            return CONFIG.defaultDepth;
        }
    }

    function saveDepthSetting(depth) {
        try {
            window.localStorage.setItem(DEPTH_STORAGE_KEY, String(depth));
        } catch (_) { }
    }

    function setAnalysisDepth(value) {
        const depth = clampDepth(value);
        state.ui.analysisDepth = depth;
        saveDepthSetting(depth);
        return depth;
    }


    function loadNumberSetting(key, fallback) {
        try {
            const value = Number(window.localStorage.getItem(key));
            return Number.isFinite(value) ? Math.max(0, value) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function saveNumberSetting(key, value) {
        try { window.localStorage.setItem(key, String(value)); } catch (_) { }
    }

    function togglePanelCollapsed() {
        const root = document.getElementById(`${SCRIPT_ID}-host`)?.shadowRoot?.querySelector('.coach-root');
        root?.classList.toggle('open');
    }

    function toggleMoveHints() {
        state.ui.boardOverlayEnabled = !state.ui.boardOverlayEnabled;
        if (!state.ui.boardOverlayEnabled) {
            cancelPendingAnalysis();
            engine.cancelSearch();
        }
        renderAll();
    }

    function renderDepthOptions() {
        const selected = clampDepth(state.ui.analysisDepth);
        const depths = Array.from({ length: CONFIG.maxDepth - CONFIG.minDepth + 1 }, (_, i) => CONFIG.minDepth + i);

        return depths
            .map(depth => `<option value="${depth}" ${depth === selected ? 'selected' : ''}>${depth}</option>`)
            .join('');
    }

    const XHR_HEADERS = {
        Accept: 'application/web.lichess+json',
        'X-Requested-With': 'XMLHttpRequest',
    };

    let stockfishWorkerURLPromise = null;
    let overlayRefreshInterval = null;
    let pendingBootstrapTimer = null;
    let pendingAnalysisTimer = null;

    const state = {
        session: null,
        bootstrapGeneration: 0,
        ui: {
            boardOverlayEnabled: true,
            analysisDepth: loadDepthSetting(),
            delayMin: loadNumberSetting(DELAY_MIN_STORAGE_KEY, 0.6),
            delayMax: loadNumberSetting(DELAY_MAX_STORAGE_KEY, 1),
        },
        engine: {
            status: 'idle',
            error: null,
            analysis: null,
        },
    };

    function debug(...args) {
        if (CONFIG.debug) console.debug(`[${SCRIPT_ID}]`, ...args);
    }

    function info(...args) {
        console.info(`[${SCRIPT_ID}]`, ...args);
    }

    function warn(...args) {
        console.warn(`[${SCRIPT_ID}]`, ...args);
    }

    function errorLog(...args) {
        console.error(`[${SCRIPT_ID}]`, ...args);
    }

    function normalizeColor(value) {
        if (value === 'white' || value === 'w') return 'white';
        if (value === 'black' || value === 'b') return 'black';
        return null;
    }

    function plyTurnColor(ply) {
        return Number(ply) % 2 === 0 ? 'white' : 'black';
    }

    function oppositeColor(color) {
        if (color === 'white') return 'black';
        if (color === 'black') return 'white';
        return null;
    }

    function colorToFenSide(color) {
        if (color === 'white') return 'w';
        if (color === 'black') return 'b';
        return null;
    }

    function fenBoardPart(fen) {
        if (typeof fen !== 'string') return '';
        return fen.trim().split(/\s+/)[0] || '';
    }

    function fullFenSideToMove(fen) {
        if (typeof fen !== 'string') return null;
        const side = fen.trim().split(/\s+/)[1];
        if (side === 'w') return 'white';
        if (side === 'b') return 'black';
        return null;
    }

    function normalizeEngineFen(rawFen, turnColor, ply) {
        const text = typeof rawFen === 'string' ? rawFen.trim() : '';
        if (!text) return '';

        const parts = text.split(/\s+/);
        const board = parts[0];
        const side = colorToFenSide(turnColor) || (parts[1] === 'w' || parts[1] === 'b' ? parts[1] : 'w');
        const castling = parts[2] || '-';
        const ep = parts[3] || '-';
        const halfmove = parts[4] || '0';
        const fullmove = parts[5] || String(Math.max(1, Math.floor((Number(ply) || 0) / 2) + 1));
        return `${board} ${side} ${castling} ${ep} ${halfmove} ${fullmove}`;
    }

    function isMyTurn(session) {
        return !!session && session.turnColor === session.myColor;
    }

    function canAnalyzeNow(session) {
        return isMyTurn(session) && !session.pendingMove;
    }

    function cancelPendingAnalysis() {
        window.clearTimeout(pendingAnalysisTimer);
        pendingAnalysisTimer = null;
    }

    function parsePossibleMoves(dests) {
        const map = new Map();
        if (!dests) return map;
        if (typeof dests === 'string') {
            for (const ds of dests.split(' ')) {
                if (typeof ds !== 'string' || ds.length < 4) continue;
                const from = ds.slice(0, 2);
                const toList = ds.slice(2).match(/.{2}/g) || [];
                map.set(from, toList);
            }
            return map;
        }
        if (typeof dests === 'object') {
            for (const [from, encoded] of Object.entries(dests)) {
                if (typeof encoded !== 'string') continue;
                map.set(from, encoded.match(/.{2}/g) || []);
            }
        }
        return map;
    }

    function isLegalMoveUci(uci, legalDests) {
        if (!uci || typeof uci !== 'string' || uci.length < 4 || !(legalDests instanceof Map)) return false;
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        return (legalDests.get(from) || []).includes(to);
    }

    function sameUci(a, b) {
        return typeof a === 'string' && typeof b === 'string' && a.slice(0, 5) === b.slice(0, 5);
    }

    function candidateMovesForDisplay() {
        const session = state.session;
        const analysis = state.engine.analysis;
        if (!canUseCoach(session) || session.status !== 'active' || !analysis || !Array.isArray(analysis.lines)) return [];

        // Do not show stale engine output. Lichess sends board FEN separately from ply,
        // so analysis must match the derived engine FEN for the current ply.
        if (!canAnalyzeNow(session)) return [];
        if (analysis.fen !== session.engineFen) return [];

        const legalDests = session.legalDests instanceof Map ? session.legalDests : new Map();
        const shouldValidateLegal = legalDests.size > 0;

        const out = [];
        for (const line of analysis.lines) {
            if (!line || !line.move) continue;
            if (shouldValidateLegal && !isLegalMoveUci(line.move, legalDests)) continue;
            out.push({
                move: line.move,
                scoreType: line.scoreType,
                scoreValue: line.scoreValue,
                display: line.scoreType === 'mate'
                    ? (() => {
                        const mate = Number(line.scoreValue);
                        const sign = mate > 0 ? '' : '-';
                        return `${sign}M${Math.abs(mate)}`;
                    })()
                    : (() => {
                        const cp = Number(line.scoreValue);
                        const prefix = cp > 0 ? '+' : '';
                        return `${prefix}${(cp / 100).toFixed(Math.abs(cp) < 100 ? 2 : 1)}`;
                    })(),
                pv: Array.isArray(line.pv) ? [...line.pv] : [],
            });
        }
        return out.slice(0, CONFIG.multipv);
    }

    function getBoardElements() {
        const board = document.querySelector('.round__app__board cg-board, .main-board cg-board, cg-board');
        if (!board) return null;
        const wrap = board.closest('.cg-wrap');
        return { board, wrap };
    }

    function getBoardRectAndOrientation() {
        const els = getBoardElements();
        if (!els) return null;
        const rect = els.board.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const orientation = els.wrap?.classList.contains('orientation-black') ? 'black' : 'white';
        return { rect, orientation };
    }

    function squareCenter(square, boardInfo) {
        if (!square || !boardInfo) return null;
        const file = square.charCodeAt(0) - 97;
        const rank = Number(square[1]);
        if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
        const sq = boardInfo.rect.width / 8;
        const xIndex = boardInfo.orientation === 'white' ? file : 7 - file;
        const yIndex = boardInfo.orientation === 'white' ? 8 - rank : rank - 1;
        return {
            x: boardInfo.rect.left + (xIndex + 0.5) * sq,
            y: boardInfo.rect.top + (yIndex + 0.5) * sq,
            size: sq,
        };
    }

    function extractCandidateMoveArrows() {
        const session = state.session;
        const boardCandidates = candidateMovesForDisplay();
        if (!session || !boardCandidates.length) return [];

        const legalDests = session.legalDests instanceof Map ? session.legalDests : new Map();
        const shouldValidateLegal = legalDests.size > 0;

        return boardCandidates
            .slice(0, CONFIG.multipv)
            .map((line, index) => {
                const move = line.move;
                if (!move || typeof move !== 'string' || move.length < 4) return null;
                if (shouldValidateLegal && !isLegalMoveUci(move, legalDests)) return null;
                return {
                    from: move.slice(0, 2),
                    to: move.slice(2, 4),
                    promotion: move.length > 4 ? move[4] : null,
                    index,
                    move,
                };
            })
            .filter(Boolean);
    }

    function ensureOverlayHost() {
        const mountTarget = document.body || document.documentElement;
        if (!mountTarget) return null;
        let host = document.getElementById(`${SCRIPT_ID}-host`);
        if (host) return host;

        host = document.createElement('div');
        host.id = `${SCRIPT_ID}-host`;
        host.style.position = 'fixed';
        host.style.inset = '0';
        host.style.pointerEvents = 'none';
        host.style.zIndex = '2147483646';
        mountTarget.appendChild(host);

        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .coach-root {
          position: absolute;
          right: 20px;
          bottom: 20px;
          width: 56px;
          height: 56px;
          pointer-events: none;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color: #f5f7fa;
        }
        .panel {
          position: absolute;
          right: 0;
          bottom: 76px;
          width: 300px;
          max-width: calc(100vw - 40px);
          box-sizing: border-box;
          border-radius: 14px;
          background: #fff;
          color: #222;
          border: 0;
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
          padding: 16px;
          pointer-events: none;
          opacity: 0;
          transform: translateY(12px) scale(.98);
          transition: opacity .2s ease, transform .2s ease;
          touch-action: none;
        }
        .coach-root.open .panel { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }
        .toggle { position: absolute; right: 0; bottom: 0; width: 56px; height: 56px; border: 0; border-radius: 50%; background: #4a8f3a; color: #fff; font-size: 34px; line-height: 1; font-weight: 700; cursor: pointer; box-shadow: 0 8px 20px rgba(0,0,0,.25); pointer-events: auto; }
        .coach-root.ui-hidden .toggle,
        .coach-root.ui-hidden .panel { display:none; }
        .panel-content { display:flex; flex-direction:column; gap:10px; }
        .panel-header { margin-bottom:6px; }
        .panel-header strong { font-weight:700; }
        .row { display:flex; align-items:center; gap:8px; margin:4px 0; }
        .row--field { flex-direction:column; align-items:flex-start; }
        .row label { font-size:13px; color:#222; cursor:pointer; }
        .row input[type=number], .row select { width:100%; max-width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:13px; color:#fff; background:#3d3d3d; }
        .spinner-overlay { display:none; position:absolute; inset:0; background:rgba(255,255,255,.8); border-radius:14px; align-items:center; justify-content:center; z-index:2; }
        .spinner { width:40px; height:40px; border:4px solid #3cba2c; border-top-color:transparent; border-radius:50%; animation:spin .8s linear infinite; }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        svg.overlay {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          overflow: visible;
        }
      </style>
      <div class="coach-root">
        <svg class="overlay" aria-hidden="true">
          <defs>
            <marker id="${SCRIPT_ID}-arrowhead-0" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse">
              <path d="M 1.7 2.2 L 8.5 5 L 1.7 7.8 z" fill="#50c878" fill-opacity="0.92"></path>
            </marker>
            <marker id="${SCRIPT_ID}-arrowhead-1" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="3.8" markerHeight="3.8" orient="auto-start-reverse">
              <path d="M 1.7 2.2 L 8.5 5 L 1.7 7.8 z" fill="#50c878" fill-opacity="0.55"></path>
            </marker>
            <marker id="${SCRIPT_ID}-arrowhead-2" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="3.1" markerHeight="3.1" orient="auto-start-reverse">
              <path d="M 1.7 2.2 L 8.5 5 L 1.7 7.8 z" fill="#50c878" fill-opacity="0.28"></path>
            </marker>
          </defs>
          <g id="overlay-layer"></g>
        </svg>
        <button id="toggle" class="toggle" type="button" aria-label="Toggle Stockfish controls">♟</button>
        <section id="panel" class="panel"></section>
      </div>
    `;

        const panel = shadow.getElementById('panel');
        const root = shadow.querySelector('.coach-root');
        shadow.getElementById('toggle').addEventListener('click', () => root.classList.toggle('open'));

        panel.addEventListener('change', event => {
            const target = event.target;
            if (target instanceof HTMLInputElement) {
                if (target.id === `${SCRIPT_ID}-hints`) {
                    state.ui.boardOverlayEnabled = target.checked;
                    if (target.checked && canUseCoach(state.session) && state.session?.status === 'active' && canAnalyzeNow(state.session)) {
                        requestAnalysis();
                    }
                    renderAll();
                    return;
                }
                if (target.id === `${SCRIPT_ID}-delay-min` || target.id === `${SCRIPT_ID}-delay-max`) {
                    const min = Math.max(0, Number(shadow.getElementById(`${SCRIPT_ID}-delay-min`)?.value) || 0);
                    const max = Math.max(min, Number(shadow.getElementById(`${SCRIPT_ID}-delay-max`)?.value) || min);
                    state.ui.delayMin = min;
                    state.ui.delayMax = max;
                    saveNumberSetting(DELAY_MIN_STORAGE_KEY, min);
                    saveNumberSetting(DELAY_MAX_STORAGE_KEY, max);
                    cancelPendingAnalysis();
                    if (state.ui.boardOverlayEnabled && canUseCoach(state.session) && state.session?.status === 'active' && canAnalyzeNow(state.session)) {
                        requestAnalysis();
                    }
                    renderAll();
                    return;
                }
            }
            if (!(target instanceof HTMLSelectElement)) return;

            if (target.id !== `${SCRIPT_ID}-depth`) return;
            const depth = setAnalysisDepth(target.value);
            target.value = String(depth);
            if (state.ui.boardOverlayEnabled && canUseCoach(state.session) && state.session?.status === 'active' && canAnalyzeNow(state.session)) requestAnalysis();
            else renderAll();
        });

        return host;
    }

    function isEditableShortcutTarget(target) {
        if (!(target instanceof Element)) return false;
        const editable = target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .mousetrap');
        if (editable) return true;
        const role = target.getAttribute?.('role');
        return role === 'textbox' || role === 'searchbox';
    }

    function consumeShortcutEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }

    function handleShortcutKeyDown(event) {
        if (event.defaultPrevented || event.repeat) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const key = String(event.key || '').toLowerCase();
        if (key !== 's' && key !== 'z' && key !== 'h') return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const target = path.find(node => node instanceof Element) || event.target;
        if (isEditableShortcutTarget(target)) return;

        consumeShortcutEvent(event);

        if (key === 's') {
            toggleMoveHints();
        } else if (key === 'z') {
            togglePanelCollapsed();
        } else if (key === 'h') {
            const root = document.getElementById(`${SCRIPT_ID}-host`)?.shadowRoot?.querySelector('.coach-root');
            root?.classList.toggle('ui-hidden');
        }
    }

    function handleShortcutKeyUp(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const key = String(event.key || '').toLowerCase();
        if (key !== 's' && key !== 'z' && key !== 'h') return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const target = path.find(node => node instanceof Element) || event.target;
        if (isEditableShortcutTarget(target)) return;
        consumeShortcutEvent(event);
    }

    function installExtensionShortcuts() {
        window.addEventListener('keydown', handleShortcutKeyDown, true);
        window.addEventListener('keyup', handleShortcutKeyUp, true);
    }

    function renderPanel() {
        const host = ensureOverlayHost();
        if (!host || !host.shadowRoot) return;
        const shadow = host.shadowRoot;
        const panel = shadow.getElementById('panel');
        panel.className = 'panel';

    panel.innerHTML = `
      <div class="spinner-overlay" style="display:${state.engine.status === 'searching' || state.engine.status === 'loading' ? 'flex' : 'none'}"><div class="spinner"></div></div>
      <div class="panel-content">
        <div class="panel-header">
          <p class="value" style="color:#222; margin:0;">Your Current Depth Is: <strong>${state.ui.analysisDepth}</strong></p>
        </div>
        <div class="row">
          <input id="${SCRIPT_ID}-hints" type="checkbox" ${state.ui.boardOverlayEnabled ? 'checked' : ''}>
          <label for="${SCRIPT_ID}-hints">Show move hints</label>
        </div>
        <div class="row row--field">
          <label for="${SCRIPT_ID}-depth">Analysis Depth</label>
          <select id="${SCRIPT_ID}-depth">${renderDepthOptions()}</select>
        </div>
        <div class="row row--field">
          <label for="${SCRIPT_ID}-delay-min">Delay Minimum (Seconds)</label>
          <input id="${SCRIPT_ID}-delay-min" type="number" min="0" step="0.1" value="${state.ui.delayMin}">
        </div>
        <div class="row row--field">
          <label for="${SCRIPT_ID}-delay-max">Delay Maximum (Seconds)</label>
          <input id="${SCRIPT_ID}-delay-max" type="number" min="0" step="0.1" value="${state.ui.delayMax}">
        </div>
      </div>
    `;
    }

    function renderOverlay() {
        const host = ensureOverlayHost();
        if (!host || !host.shadowRoot) return;
        const shadow = host.shadowRoot;
        const layer = shadow.getElementById('overlay-layer');
        layer.innerHTML = '';

        const session = state.session;
        if (!canUseCoach(session) || session.status !== 'active' || !state.ui.boardOverlayEnabled) return;
        if (!isMyTurn(session)) return;

        const arrows = extractCandidateMoveArrows();
        const boardInfo = getBoardRectAndOrientation();
        if (!arrows.length || !boardInfo) return;

        const arrowStyles = [
            { opacity: 0.92, strokeScale: 0.2, minStroke: 6, radiusScale: 0.18 },
            { opacity: 0.55, strokeScale: 0.12, minStroke: 4, radiusScale: 0.135 },
            { opacity: 0.28, strokeScale: 0.07, minStroke: 3, radiusScale: 0.095 },
        ];

        const parts = [];
        for (const arrow of arrows) {
            const from = squareCenter(arrow.from, boardInfo);
            const to = squareCenter(arrow.to, boardInfo);
            if (!from || !to) continue;

            const index = Math.min(arrow.index || 0, 2);
            const style = arrowStyles[index] || arrowStyles[2];
            const opacity = style.opacity;
            const strokeWidth = Math.max(style.minStroke, from.size * style.strokeScale);
            const circleRadius = Math.max(5, from.size * style.radiusScale);
            const markerId = `${SCRIPT_ID}-arrowhead-${index}`;

            parts.push(`
        <g opacity="${opacity}">
          <line
            x1="${from.x}"
            y1="${from.y}"
            x2="${to.x}"
            y2="${to.y}"
            stroke="#50c878"
            stroke-width="${strokeWidth}"
            stroke-linecap="round"
            marker-end="url(#${markerId})"
          ></line>
          <circle
            cx="${from.x}"
            cy="${from.y}"
            r="${circleRadius}"
            fill="rgba(80, 200, 120, 0.16)"
            stroke="#50c878"
            stroke-width="1.6"
          ></circle>
          <circle
            cx="${to.x}"
            cy="${to.y}"
            r="${circleRadius}"
            fill="rgba(80, 200, 120, 0.26)"
            stroke="#50c878"
            stroke-width="1.6"
          ></circle>
        </g>
      `);
        }

        layer.innerHTML = parts.join('');
    }

    function renderAll() {
        renderPanel();
        renderOverlay();
    }

    function scheduleOverlayRefresh() {
        if (overlayRefreshInterval) return;
        overlayRefreshInterval = window.setInterval(() => renderOverlay(), CONFIG.overlayRefreshMs);
        window.addEventListener('resize', renderOverlay, { passive: true });
        window.addEventListener('scroll', renderOverlay, { passive: true });
    }

    function injectBridge() {
        if (window.__LICHESS_STOCKFISH_COACH_BRIDGE_INJECTED__) return;
        info('injectBridge: preparing page bridge');

        const source = BRIDGE_SOURCE;
        const bridgeCode = `
      (() => {
        const SOURCE = ${JSON.stringify(source)};
        const log = (...args) => {
          try { console.info('[${SCRIPT_ID}:bridge]', ...args); } catch (_) {}
        };
        const NativeWebSocket = window.WebSocket;
        if (!NativeWebSocket || window.__LICHESS_STOCKFISH_COACH_BRIDGED__) {
          log('bridge skipped', { hasWebSocket: !!NativeWebSocket, already: !!window.__LICHESS_STOCKFISH_COACH_BRIDGED__ });
          return;
        }
        window.__LICHESS_STOCKFISH_COACH_BRIDGED__ = true;
        log('bridge boot');

        const emit = (type, payload) => {
          try {
            window.postMessage({ source: SOURCE, type, payload }, '*');
          } catch (_) {}
        };

        const parseMeta = rawUrl => {
          try {
            const url = new URL(String(rawUrl), location.origin);
            const path = url.pathname || '';
            const parts = path.split('/').filter(Boolean);
            if (parts.length === 3 && parts[0] === 'play' && /^v\\d+$/.test(parts[2])) {
              const fullId = parts[1];
              return { kind: 'play', fullId, gameId: fullId.slice(0, 8), url: url.href };
            }
            if (parts.length === 4 && parts[0] === 'watch' && (parts[2] === 'white' || parts[2] === 'black') && /^v\\d+$/.test(parts[3])) {
              return { kind: 'watch', gameId: parts[1], color: parts[2], url: url.href };
            }
          } catch (_) {}
          return null;
        };

        const watchSocket = (socket, rawUrl) => {
          const meta = parseMeta(rawUrl);
          if (!meta) return;
          log('socket detected', meta);
          emit('ROUND_SOCKET_OPEN', meta);

          const originalSend = socket.send;
          socket.send = function patchedSend(data) {
            try {
              if (typeof data === 'string') {
                const msg = JSON.parse(data);
                if (msg && typeof msg.t === 'string') log('socket out', msg.t, msg);
                if (msg && typeof msg.t === 'string') emit('ROUND_SOCKET_OUT', { meta, msg });
              }
            } catch (_) {}
            return originalSend.apply(this, arguments);
          };

          socket.addEventListener('message', event => {
            try {
              if (typeof event.data !== 'string' || event.data === '0') return;
              const msg = JSON.parse(event.data);
              if (msg && typeof msg.t === 'string') log('socket in', msg.t, msg);
              if (msg && typeof msg.t === 'string') emit('ROUND_SOCKET_IN', { meta, msg });
            } catch (_) {}
          });
        };

        function WrappedWebSocket(url, protocols) {
          const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
          try {
            watchSocket(ws, url);
          } catch (_) {}
          return ws;
        }

        WrappedWebSocket.prototype = NativeWebSocket.prototype;
        Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
        for (const key of Object.getOwnPropertyNames(NativeWebSocket)) {
          if (key in WrappedWebSocket) continue;
          try {
            Object.defineProperty(WrappedWebSocket, key, Object.getOwnPropertyDescriptor(NativeWebSocket, key));
          } catch (_) {}
        }
        window.WebSocket = WrappedWebSocket;
        log('bridge installed');
        emit('BRIDGE_READY', { ok: true });
      })();
    `;

        const getPageNonce = () => {
            const bodyNonce = document.body?.getAttribute('data-nonce');
            if (bodyNonce) return bodyNonce;

            const htmlNonce = document.documentElement?.getAttribute('data-nonce');
            if (htmlNonce) return htmlNonce;

            const scriptNonce =
                document.querySelector('script[nonce]')?.nonce ||
                document.querySelector('script[nonce]')?.getAttribute('nonce');
            if (scriptNonce) return scriptNonce;

            return null;
        };

        const mount = () => {
            const target = document.documentElement || document.head || document.body;
            if (!target) {
                window.setTimeout(mount, 0);
                return;
            }

            const nonce = getPageNonce();
            if (!nonce) {
                info('injectBridge: nonce not ready yet');
                window.setTimeout(mount, 25);
                return;
            }

            window.__LICHESS_STOCKFISH_COACH_BRIDGE_INJECTED__ = true;
            const script = document.createElement('script');
            script.nonce = nonce;
            script.textContent = bridgeCode;
            try {
                info('injectBridge: appending bridge script', { nonce, target: target.tagName });
                target.appendChild(script);
                info('injectBridge: bridge script appended');
            } catch (err) {
                errorLog('injectBridge: append failed', err, bridgeCode);
                window.__LICHESS_STOCKFISH_COACH_BRIDGE_INJECTED__ = false;
                return;
            } finally {
                script.remove();
            }
        };

        mount();
    }

    function gmGetText(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                overrideMimeType: 'text/plain',
                onload: response => {
                    if (response.status >= 200 && response.status < 300) resolve(response.responseText || '');
                    else reject(new Error(`HTTP ${response.status} when fetching ${url}`));
                },
                onerror: error => reject(new Error(`Network error when fetching ${url}: ${error?.error || 'unknown'}`)),
            });
        });
    }

    function gmGetArrayBuffer(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'arraybuffer',
                onload: response => {
                    if (response.status >= 200 && response.status < 300 && response.response) {
                        resolve(response.response);
                    } else {
                        reject(new Error(`HTTP ${response.status} when fetching binary ${url}`));
                    }
                },
                onerror: error => reject(new Error(`Network error when fetching binary ${url}: ${error?.error || 'unknown'}`)),
            });
        });
    }

    let engineCacheDbPromise = null;

    function engineCacheKey(url) {
        return `${ENGINE_CACHE_VERSION}:${url}`;
    }

    function idbRequestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
    }

    function openEngineCacheDb() {
        if (engineCacheDbPromise) return engineCacheDbPromise;
        if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'));

        engineCacheDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(ENGINE_CACHE_DB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(ENGINE_CACHE_STORE_NAME)) {
                    db.createObjectStore(ENGINE_CACHE_STORE_NAME, { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                engineCacheDbPromise = null;
                reject(request.error || new Error('IndexedDB open failed'));
            };
            request.onblocked = () => warn('Stockfish engine cache database is blocked by another tab');
        });

        return engineCacheDbPromise;
    }

    async function readEngineCache(url) {
        try {
            const db = await openEngineCacheDb();
            const tx = db.transaction(ENGINE_CACHE_STORE_NAME, 'readonly');
            return await idbRequestToPromise(tx.objectStore(ENGINE_CACHE_STORE_NAME).get(engineCacheKey(url)));
        } catch (error) {
            warn('Stockfish engine cache read skipped', url, error?.message || String(error));
            return null;
        }
    }

    async function writeEngineCache(url, type, data) {
        try {
            const db = await openEngineCacheDb();
            const tx = db.transaction(ENGINE_CACHE_STORE_NAME, 'readwrite');
            const record = {
                key: engineCacheKey(url),
                version: ENGINE_CACHE_VERSION,
                url,
                type,
                data,
                savedAt: Date.now(),
            };
            await idbRequestToPromise(tx.objectStore(ENGINE_CACHE_STORE_NAME).put(record));
        } catch (error) {
            warn('Stockfish engine cache write skipped', url, error?.message || String(error));
        }
    }

    async function getCachedText(url) {
        const cached = await readEngineCache(url);
        if (cached?.type === 'text' && typeof cached.data === 'string') {
            info('Stockfish engine cache hit', url);
            return cached.data;
        }

        info('Stockfish engine cache miss; downloading', url);
        const text = await gmGetText(url);
        await writeEngineCache(url, 'text', text);
        return text;
    }

    async function getCachedArrayBuffer(url) {
        const cached = await readEngineCache(url);
        if (cached?.type === 'arraybuffer' && cached.data && typeof cached.data.byteLength === 'number') {
            info('Stockfish engine cache hit', url);
            return cached.data;
        }

        info('Stockfish engine cache miss; downloading', url);
        const buffer = await gmGetArrayBuffer(url);
        await writeEngineCache(url, 'arraybuffer', buffer);
        return buffer;
    }

    async function gmTryGetArrayBuffer(url) {
        try {
            const buffer = await getCachedArrayBuffer(url);
            return { url, buffer, ok: true };
        } catch (error) {
            // Missing split parts are normal across different Stockfish builds.
            // Do not fail the whole engine boot just because part-5/part-6/etc. is absent.
            warn('Stockfish binary preload skipped', url, error?.message || String(error));
            return { url, buffer: null, ok: false, error };
        }
    }

    function createBinaryBlobUrl(buffer, mimeType = 'application/wasm') {
        return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
    }

    function addRedirectAlias(map, url, blobUrl) {
        if (!url || !blobUrl) return;
        map[url] = blobUrl;
        try {
            const parsed = new URL(url, location.href);
            map[parsed.href] = blobUrl;
            map[parsed.pathname] = blobUrl;
            map[parsed.pathname.split('/').pop()] = blobUrl;
        } catch (_) {
            const clean = String(url);
            map[clean] = blobUrl;
            map[clean.split('/').pop()] = blobUrl;
        }
    }

    async function ensureStockfishWorkerURL() {
        if (stockfishWorkerURLPromise) return stockfishWorkerURLPromise;

        const stockfishScriptURL = `${STOCKFISH_BASE_URL}${STOCKFISH_MAIN_SCRIPT}`;
        stockfishWorkerURLPromise = (async () => {
            const source = await getCachedText(stockfishScriptURL);

            if (!source.includes(STOCKFISH_BOOTSTRAP_PATTERN)) {
                stockfishWorkerURLPromise = null;
                throw new Error('Unexpected Stockfish bootstrap format');
            }

            const binaryUrls = [STOCKFISH_WASM_URL, ...STOCKFISH_WASM_PART_URLS];
            const binaryResults = await Promise.all(binaryUrls.map(url => gmTryGetArrayBuffer(url)));
            const fetchRedirects = {};

            for (const result of binaryResults) {
                if (!result.ok || !result.buffer) continue;
                addRedirectAlias(fetchRedirects, result.url, createBinaryBlobUrl(result.buffer));
            }

            if (!Object.keys(fetchRedirects).length) {
                throw new Error('Stockfish WASM preload failed: no binary files could be downloaded with GM_xmlhttpRequest');
            }

            const patched = source.replace(STOCKFISH_BOOTSTRAP_PATTERN, `a='${STOCKFISH_WASM_URL}'`);
            const prelude = `
const __LSC_FETCH_REDIRECTS__ = ${JSON.stringify(fetchRedirects)};
const __LSC_NATIVE_FETCH__ = self.fetch.bind(self);
const __LSC_FETCH_KEYS__ = function(input) {
  const raw = typeof input === 'string' ? input : (input && input.url ? String(input.url) : '');
  const keys = [];
  if (raw) keys.push(raw);
  try {
    const parsed = new URL(raw, self.location.href);
    keys.push(parsed.href, parsed.pathname, parsed.pathname.split('/').pop());
  } catch (_) {
    if (raw) keys.push(raw.split('/').pop());
  }
  return [...new Set(keys.filter(Boolean))];
};
self.fetch = function(input, init) {
  for (const key of __LSC_FETCH_KEYS__(input)) {
    const mappedUrl = __LSC_FETCH_REDIRECTS__[key];
    if (mappedUrl) return __LSC_NATIVE_FETCH__(mappedUrl, init);
  }
  const raw = typeof input === 'string' ? input : (input && input.url ? String(input.url) : '');
  if (/stockfish-17\\.1-single-a496a04.*\\.wasm/.test(raw)) {
    return Promise.reject(new Error('Stockfish binary was not preloaded: ' + raw));
  }
  return __LSC_NATIVE_FETCH__(input, init);
};
self.Module = self.Module || {};
self.Module.locateFile = self.Module.locateFile || function(path) {
  const remoteUrl = '${STOCKFISH_BASE_URL}' + path;
  return __LSC_FETCH_REDIRECTS__[remoteUrl] || __LSC_FETCH_REDIRECTS__[path] || remoteUrl;
};
`;
            const blob = new Blob([prelude, patched], { type: 'application/javascript' });
            return URL.createObjectURL(blob);
        })().catch(error => {
            stockfishWorkerURLPromise = null;
            throw error;
        });

        return stockfishWorkerURLPromise;
    }

    class StockfishEngine {
        constructor() {
            this.worker = null;
            this.currentJob = null;
            this.nextJob = null;
            this.status = 'idle';
            this.initialized = false;
            this.booting = false;
            this.lineMap = new Map();
        }

        async ensureReady() {
            if (this.initialized && this.worker) return;
            if (this.booting) return;

            this.booting = true;
            this.setStatus('loading');

            try {
                const workerUrl = await ensureStockfishWorkerURL();
                this.worker = new Worker(workerUrl);
                this.worker.onmessage = event => this.handleMessage(String(event.data || ''));
                this.worker.onerror = error => {
                    try { this.worker?.terminate(); } catch (_) { }
                    this.worker = null;
                    this.currentJob = null;
                    this.nextJob = null;
                    this.initialized = false;
                    this.lineMap.clear();
                    this.setStatus('error', error?.message || 'Worker error');
                };
                this.send('uci');
            } catch (error) {
                this.setStatus('error', error?.message || String(error));
            } finally {
                this.booting = false;
            }
        }

        setStatus(status, error = null, render = true) {
            state.engine.status = status;
            state.engine.error = error;
            if (render) renderAll();
        }

        send(command) {
            if (this.worker) this.worker.postMessage(command);
        }

        handleMessage(message) {
            debug('engine', message);

            if (message === 'uciok') {
                this.send(`setoption name Threads value ${CONFIG.engineThreads}`);
                this.send(`setoption name Hash value ${CONFIG.engineHashMb}`);
                this.send(`setoption name MultiPV value ${CONFIG.multipv}`);
                this.send('setoption name UCI_AnalyseMode value true');
                this.send('isready');
                return;
            }

            if (message === 'readyok') {
                this.initialized = true;
                this.setStatus('ready');
                if (this.nextJob && !this.currentJob) {
                    const queued = this.nextJob;
                    this.nextJob = null;
                    this.startJob(queued);
                }
                return;
            }

            if (message.startsWith('info ')) {
                if (!this.currentJob) return;
                const parsed = parseEngineInfo(message);
                if (!parsed) return;
                this.lineMap.set(parsed.multipv, parsed);
                const lines = [...this.lineMap.values()].sort((a, b) => a.multipv - b.multipv);
                state.engine.analysis = {
                    fen: this.currentJob.fen,
                    depth: lines.reduce((max, line) => Math.max(max, line.depth || 0), 0),
                    lines,
                    bestLine: lines[0] || null,
                    bestMove: lines[0]?.move || null,
                    complete: false,
                };
                renderAll();
                return;
            }

            if (message.startsWith('bestmove ')) {
                if (!this.currentJob) return;
                const bestmoveMatch = /^bestmove\s+(\S+)/.exec(message);
                const bestMove = bestmoveMatch ? bestmoveMatch[1] : '(none)';
                const lines = [...this.lineMap.values()].sort((a, b) => a.multipv - b.multipv);
                state.engine.analysis = {
                    fen: this.currentJob.fen,
                    depth: lines.reduce((max, line) => Math.max(max, line.depth || 0), 0),
                    lines,
                    bestLine: lines[0] || null,
                    bestMove,
                    complete: true,
                };
                this.currentJob = null;
                this.lineMap.clear();
                this.setStatus('ready');
                renderAll();

                if (this.nextJob) {
                    const queued = this.nextJob;
                    this.nextJob = null;
                    this.startJob(queued);
                }
            }
        }

        search(job) {
            if (!this.initialized || !this.worker || this.booting) {
                this.nextJob = job;
                this.ensureReady();
                return;
            }
            if (this.currentJob) {
                this.nextJob = job;
                return;
            }
            this.startJob(job);
        }

        cancelSearch() {
            if (this.worker && this.currentJob) {
                this.send('stop');
            }
            this.currentJob = null;
            this.nextJob = null;
            this.lineMap.clear();
            state.engine.analysis = null;
            if (this.initialized) this.setStatus('ready');
        }

        startJob(job) {
            if (!this.worker) return;
            this.currentJob = job;
            this.lineMap.clear();
            this.setStatus('searching');
            state.engine.analysis = {
                fen: job.fen,
                depth: 0,
                lines: [],
                bestLine: null,
                bestMove: null,
                complete: false,
            };
            this.send('position fen ' + job.fen);
            this.send(`go depth ${state.ui.analysisDepth}`);
            renderAll();
        }

        destroy() {
            try {
                this.worker?.terminate();
            } catch (_) { }
            this.worker = null;
            this.currentJob = null;
            this.nextJob = null;
            this.initialized = false;
            this.booting = false;
            this.lineMap.clear();
            state.engine.analysis = null;
            this.setStatus('idle', null, false);
        }
    }

    function parseEngineInfo(message) {
        const depthMatch = /\bdepth\s+(\d+)/.exec(message);
        const multipvMatch = /\bmultipv\s+(\d+)/.exec(message);
        const mateMatch = /\bscore\s+mate\s+(-?\d+)/.exec(message);
        const cpMatch = /\bscore\s+cp\s+(-?\d+)/.exec(message);
        const pvMatch = /\bpv\s+([a-h][1-8][a-h][1-8][nbrq]?(?:\s+[a-h][1-8][a-h][1-8][nbrq]?){0,20})/.exec(message);

        if ((!mateMatch && !cpMatch) || !pvMatch) return null;
        const pv = pvMatch[1].trim().split(/\s+/).filter(Boolean);
        return {
            depth: depthMatch ? Number(depthMatch[1]) : 0,
            multipv: multipvMatch ? Number(multipvMatch[1]) : 1,
            scoreType: mateMatch ? 'mate' : 'cp',
            scoreValue: Number((mateMatch || cpMatch)[1]),
            pv,
            move: pv[0] || null,
        };
    }

    const engine = new StockfishEngine();

    async function fetchRoundData(fullId) {
        info('fetchRoundData:start', fullId);
        const response = await fetch(`${location.origin}/${fullId}`, {
            cache: 'no-cache',
            credentials: 'same-origin',
            headers: XHR_HEADERS,
        });
        if (!response.ok) throw new Error(`Bootstrap failed (${response.status})`);
        const json = await response.json();
        info('fetchRoundData:ok', fullId, {
            gameId: json?.game?.id,
            source: json?.game?.source,
            myColor: json?.player?.color,
            opponentAi: json?.opponent?.ai,
        });
        return json;
    }

    function guardStatusFromData(data) {
        return evaluateGuardDecision(data);
    }

    function buildSession(fullId, data) {
        const lastStep = Array.isArray(data?.steps) && data.steps.length ? data.steps[data.steps.length - 1] : null;
        const fen = lastStep?.fen || data?.game?.fen || '';
        const ply = Number.isFinite(lastStep?.ply) ? Number(lastStep.ply) : Number(data?.game?.turns || 0);
        const myColor = normalizeColor(data?.player?.color);
        // Lichess round FEN is a board FEN. The authoritative side-to-move is derived from ply.
        const turnColor = Number.isFinite(ply) ? plyTurnColor(ply) : normalizeColor(data?.game?.player) || 'white';
        const engineFen = normalizeEngineFen(fen, turnColor, ply);
        const legalDests = turnColor === myColor ? parsePossibleMoves(data?.possibleMoves) : new Map();
        const guard = guardStatusFromData(data);

        return {
            fullId,
            gameId: data?.game?.id || fullId.slice(0, 8),
            myColor,
            turnColor,
            guard,
            // Backward-compatible aliases for older debug logs. Runtime checks use guard/canUseCoach.
            isAiGame: guard.canCoach,
            guardStatus: guard.status,
            guardReason: guard.reason,
            fen,
            engineFen,
            ply,
            legalDests,
            lastServerMoveUci: lastStep?.uci || null,
            lastServerMoveSan: lastStep?.san || null,
            pendingMove: null,
            pendingSince: 0,
            variantKey: data?.game?.variant?.key || null,
            source: data?.game?.source || null,
            playerVersion: data?.player?.version ?? null,
            isSpectator: !!data?.player?.spectator,
            raw: data,
            status: guard.sessionStatus,
            desyncReason: null,
            bootstrapAt: Date.now(),
            updatedAt: Date.now(),
        };
    }

    function schedulePendingTimeout() {
        const session = state.session;
        if (!session || !session.pendingMove) return;

        window.clearTimeout(session.pendingTimerId);
        session.pendingTimerId = window.setTimeout(() => {
            if (!state.session || !state.session.pendingMove) return;
            markDesynced(`No server confirmation for ${state.session.pendingMove}`);
            scheduleBootstrap(state.session.fullId, 'pending-timeout');
        }, CONFIG.pendingMoveTimeoutMs);
    }

    function clearPending(session) {
        if (!session) return;
        session.pendingMove = null;
        session.pendingSince = 0;
        if (session.pendingTimerId) {
            window.clearTimeout(session.pendingTimerId);
            session.pendingTimerId = null;
        }
    }

    function markDesynced(reason) {
        if (!state.session) return;
        state.session.status = 'desynced';
        state.session.desyncReason = reason;
        debug('desync', reason);
        renderAll();
    }

    function commitInboundMove(meta, moveData) {
        const session = state.session;
        if (!session || session.fullId !== meta.fullId) return;
        if (!moveData || typeof moveData !== 'object') return;

        if (typeof moveData.fen !== 'string' || !Number.isFinite(Number(moveData.ply))) {
            cancelPendingAnalysis();
            engine.cancelSearch();
            scheduleBootstrap(meta.fullId, 'incomplete-move-data');
            return;
        }

        const inboundUci = typeof moveData.uci === 'string' ? moveData.uci : null;
        const inboundPly = Number(moveData.ply);
        const inboundFen = typeof moveData.fen === 'string' ? moveData.fen : null;
        const nextFen = inboundFen || session.fen;
        const nextPly = Number.isFinite(inboundPly) ? inboundPly : session.ply;
        // Lichess itself updates d.game.player from plyColor(o.ply). Do the same here.
        const nextTurnColor = Number.isFinite(nextPly) ? plyTurnColor(nextPly) : session.turnColor;
        const playedColor = oppositeColor(nextTurnColor);
        const nextEngineFen = normalizeEngineFen(nextFen, nextTurnColor, nextPly);

        cancelPendingAnalysis();
        engine.cancelSearch();

        if (session.pendingMove && inboundUci && !sameUci(session.pendingMove, inboundUci)) {
            if (!playedColor || playedColor === session.myColor) {
                markDesynced(`Pending ${session.pendingMove} but got ${inboundUci}`);
            } else {
                debug('pending move was not confirmed before opponent move; clearing from ply state', {
                    pending: session.pendingMove,
                    inboundUci,
                    nextPly,
                });
            }
        }

        session.turnColor = nextTurnColor;
        session.ply = nextPly;
        session.fen = nextFen;
        session.engineFen = nextEngineFen;
        session.lastServerMoveUci = inboundUci;
        session.lastServerMoveSan = typeof moveData.san === 'string' ? moveData.san : null;
        session.legalDests = nextTurnColor === session.myColor ? parsePossibleMoves(moveData.dests) : new Map();
        session.updatedAt = Date.now();
        session.status = session.guard?.sessionStatus || 'inactive';
        session.desyncReason = null;

        if (session.pendingMove && inboundUci && sameUci(session.pendingMove, inboundUci)) clearPending(session);
        else if (session.pendingMove && nextTurnColor === session.myColor) clearPending(session);

        if (state.ui.boardOverlayEnabled && session.turnColor === session.myColor && canUseCoach(session)) requestAnalysis();

        renderAll();
    }

    function handleOutboundMove(meta, msg) {
        const session = state.session;
        if (!session || session.fullId !== meta.fullId || !canUseCoach(session) || session.status !== 'active') return;
        if (!msg || typeof msg !== 'object') return;

        if (msg.t === 'move' && msg.d && typeof msg.d.u === 'string') {
            cancelPendingAnalysis();
            engine.cancelSearch();
            session.pendingMove = msg.d.u;
            session.pendingSince = Date.now();
            session.updatedAt = Date.now();
            session.status = session.guard?.sessionStatus || 'inactive';
            state.engine.analysis = null;
            schedulePendingTimeout();
            renderAll();
            return;
        }

        if (msg.t === 'drop') {
            cancelPendingAnalysis();
            engine.cancelSearch();
            session.pendingMove = typeof msg.d?.pos === 'string' && typeof msg.d?.role === 'string' ? `${msg.d.role}@${msg.d.pos}` : 'drop';
            session.pendingSince = Date.now();
            state.engine.analysis = null;
            schedulePendingTimeout();
            renderAll();
        }
    }

    function requestAnalysis() {
        window.clearTimeout(pendingAnalysisTimer);
        const min = Math.min(state.ui.delayMin, state.ui.delayMax);
        const max = Math.max(state.ui.delayMin, state.ui.delayMax);
        const delay = (min + Math.random() * (max - min)) * 1000;
        const requestedSession = state.session;
        const requestedFen = requestedSession?.fen;
        pendingAnalysisTimer = window.setTimeout(() => {
            pendingAnalysisTimer = null;
            if (state.session !== requestedSession || state.session?.fen !== requestedFen) return;
            performAnalysis();
        }, delay);
    }

    function performAnalysis() {
        const session = state.session;
        if (!state.ui.boardOverlayEnabled || !canUseCoach(session) || session.status !== 'active' || !session?.fen) {
            state.engine.analysis = null;
            renderAll();
            return;
        }

        if (!session.engineFen) session.engineFen = normalizeEngineFen(session.fen, session.turnColor, session.ply);

        // Only analyze stable positions where Lichess ply says it is our turn.
        if (!canAnalyzeNow(session)) {
            state.engine.analysis = null;
            renderAll();
            return;
        }

        engine.search({
            fen: session.engineFen,
            gameId: session.gameId,
        });
    }

    function onBootstrapSuccess(fullId, data, generation) {
        if (generation !== state.bootstrapGeneration) return;

        cancelPendingAnalysis();
        engine.cancelSearch();
        const session = buildSession(fullId, data);
        clearPending(state.session);
        state.session = session;
        state.engine.analysis = null;
        renderAll();

        if (state.ui.boardOverlayEnabled && canUseCoach(session) && session.status === 'active') requestAnalysis();
    }

    function onBootstrapFailure(fullId, error, generation) {
        if (generation !== state.bootstrapGeneration) return;
        cancelPendingAnalysis();
        engine.cancelSearch();
        debug('bootstrap failed', fullId, error);
        if (state.session) {
            state.session.status = 'desynced';
            state.session.desyncReason = error?.message || String(error);
            renderAll();
        }
    }

    function scheduleBootstrap(fullId, reason) {
        if (!fullId) return;
        info('scheduleBootstrap', { fullId, reason });
        window.clearTimeout(pendingBootstrapTimer);
        pendingBootstrapTimer = window.setTimeout(() => {
            bootstrapFromFullId(fullId, reason);
        }, CONFIG.bootstrapDebounceMs);
    }

    async function bootstrapFromFullId(fullId, reason) {
        if (!fullId) return;
        const generation = ++state.bootstrapGeneration;
        info('bootstrap:start', { fullId, reason, generation });

        const priorSession = state.session;
        if (!priorSession || priorSession.fullId !== fullId) {
            const bootstrapGuard = evaluateGuardDecision(null);
            state.session = {
                fullId,
                gameId: fullId.slice(0, 8),
                myColor: null,
                turnColor: null,
                guard: bootstrapGuard,
                isAiGame: bootstrapGuard.canCoach,
                guardStatus: bootstrapGuard.status,
                guardReason: bootstrapGuard.reason,
                fen: '',
                engineFen: '',
                ply: 0,
                legalDests: new Map(),
                lastServerMoveUci: null,
                lastServerMoveSan: null,
                pendingMove: null,
                pendingSince: 0,
                variantKey: null,
                source: null,
                playerVersion: null,
                isSpectator: false,
                raw: null,
                status: bootstrapGuard.sessionStatus,
                desyncReason: null,
                bootstrapAt: Date.now(),
                updatedAt: Date.now(),
            };
            renderAll();
        }

        try {
            const data = await fetchRoundData(fullId);
            onBootstrapSuccess(fullId, data, generation);
        } catch (error) {
            onBootstrapFailure(fullId, error, generation);
        }
    }

    function handleBridgeMessage(event) {
        if (CONFIG.debug && event?.data?.source === BRIDGE_SOURCE) {
            info('bridge:raw-event', {
                sourceMatchesWindow: event.source === window,
                type: event.data.type,
                payload: event.data.payload,
            });
        }
        if (!event.data || event.data.source !== BRIDGE_SOURCE) return;
        const { type, payload } = event.data;
        info('bridge:event', type, payload);
        if (type === 'BRIDGE_READY') {
            info('bridge ready');
            return;
        }

        if (type === 'ROUND_SOCKET_OPEN') {
            const meta = payload;
            if (!meta || meta.kind !== 'play') return;
            const current = state.session?.fullId;
            if (current !== meta.fullId) scheduleBootstrap(meta.fullId, 'socket-open');
            return;
        }

        if (type === 'ROUND_SOCKET_OUT') {
            const meta = payload?.meta;
            const msg = payload?.msg;
            if (!meta || meta.kind !== 'play') return;
            if (state.session?.fullId !== meta.fullId && !state.session) scheduleBootstrap(meta.fullId, 'outbound-before-bootstrap');
            handleOutboundMove(meta, msg);
            return;
        }

        if (type === 'ROUND_SOCKET_IN') {
            const meta = payload?.meta;
            const msg = payload?.msg;
            if (!meta || meta.kind !== 'play' || !msg) return;

            if (!state.session || state.session.fullId !== meta.fullId) {
                scheduleBootstrap(meta.fullId, 'inbound-before-bootstrap');
                return;
            }

            if (msg.t === 'move' || msg.t === 'drop') {
                commitInboundMove(meta, msg.d);
                return;
            }

            if (msg.t === 'reload') {
                scheduleBootstrap(meta.fullId, 'reload-event');
                return;
            }

            if (msg.t === 'endData') {
                clearPending(state.session);
                renderAll();
            }
        }
    }

    function boot() {
        info('boot:start');
        injectBridge();
        installExtensionShortcuts();
        window.addEventListener('message', handleBridgeMessage, false);
        info('boot:message-listener-attached');
        window.addEventListener('beforeunload', () => engine.destroy(), { once: true });

        const mountUi = () => {
            info('boot:mountUi');
            ensureOverlayHost();
            renderAll();
            scheduleOverlayRefresh();
        };

        if (document.body) mountUi();
        else window.addEventListener('DOMContentLoaded', mountUi, { once: true });
    }

    boot();
})();
