(function() {
    'use strict';
    
    window.addEventListener('chess-bot-toggle', (e) => {
        if (typeof window.setChessBotEnabled === 'function') {
            window.setChessBotEnabled(e.detail.enabled);
        }
    });
    
    function init() {
        if (typeof jQuery !== 'undefined') {
            mainScript();
            return;
        }
        
        const jqueryScript = document.createElement('script');
        jqueryScript.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
        jqueryScript.onload = mainScript;
        (document.head || document.documentElement).appendChild(jqueryScript);
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

function mainScript() {
'use strict';

const $ = jQuery;
const ROOT_WINDOW = window;

const VERSION = '1.8.3.6';
const STOCKFISH_BASE_URL = 'https://cdn.jsdelivr.net/gh/dodaonam/stockfish.js@main/171_single_nnue/';
const STOCKFISH_MAIN_SCRIPT = 'stockfish-17.1-single-a496a04.js';
const STOCKFISH_WASM_URL = `${STOCKFISH_BASE_URL}stockfish-17.1-single-a496a04.wasm`;
const STOCKFISH_BOOTSTRAP_PATTERN = 'a=decodeURIComponent(e[0]||location.origin+location.pathname.replace(/\\.js$/i,".wasm"))';
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const DEFAULT_DEPTH = 11;
const HIGHLIGHT_DURATION_MS = 1800;
const HIGHLIGHT_COLOR = 'rgb(235, 97, 80)';
const HIGHLIGHT_OPACITY = 0.71;

const DEPTH_HOTKEYS = {
    81: 1,
    87: 2,
    69: 3,
    82: 4,
    84: 5,
    89: 6,
    85: 7,
    73: 8,
    79: 9,
    80: 10,
    65: 11,
    83: 12,
    68: 13,
    70: 14,
    71: 15,
    72: 16,
    74: 17,
    75: 18,
    76: 19,
    90: 20,
    88: 21,
    67: 22,
    86: 23,
    66: 24,
    78: 25,
    77: 26,
    187: 100
};

const COL_TO_NUM = {
    'a': '1', 'b': '2', 'c': '3', 'd': '4',
    'e': '5', 'f': '6', 'g': '7', 'h': '8'
};

let isThinking = false;
let canGo = true;
let myTurn = false;
let board = null;
let extensionEnabled = true;
let stockfishWorkerURLPromise = null;

const evaluationState = {
    type: null,
    value: null,
    depth: null,
    updatedAt: 0
};

const engineMetrics = {
    nodes: 0,
    nps: 0,
    seldepth: 0,
    volatility: 0,
    lastScoreType: null,
    lastScoreValue: null,
    lastScoreTime: 0
};

const tempoStats = {
    myTurnStartedAt: null,
    oppTurnStartedAt: null,
    myAverageMs: null,
    oppAverageMs: null,
    lastIsMyTurn: null
};

const searchContext = {
    sideToMove: 'w'
};

let isInActiveGame = false;
let confirmedPlayerColor = null;

window.setChessBotEnabled = function(enabled) {
    extensionEnabled = enabled;
    console.log('[Chess Bot] Extension ' + (enabled ? 'enabled' : 'disabled'));
    
    const controlPanel = document.getElementById('sf-ctrl-panel');
    if (controlPanel) {
        controlPanel.style.opacity = enabled ? '1' : '0.5';
        controlPanel.style.pointerEvents = enabled ? 'auto' : 'none';
    }
    
    const evalRoot = document.getElementById('sf-eval-root');
    if (evalRoot) {
        evalRoot.style.display = enabled ? '' : 'none';
    }
    
    if (!enabled && typeof myFunctions !== 'undefined' && myFunctions.stopSf) {
        myFunctions.stopSf();
    }
};

function getPlayerColor() {
    try{
        const stored = document && document.myVars && document.myVars.playingAs;
        return stored === 'black' ? 'black' : 'white';
    } catch (error){
        return 'white';
    }
}

function clamp(value, min, max){
    if(!Number.isFinite(value)){
        return min;
    }
    return Math.min(Math.max(value, min), max);
}

function updateMovingAverage(current, sample, weight = 0.2){
    if(!Number.isFinite(sample) || sample <= 0){
        return current;
    }
    if(!Number.isFinite(current) || current <= 0){
        return sample;
    }
    return current + (sample - current) * clamp(weight, 0, 1);
}

function getTempoSeconds(isPlayer){
    const ms = isPlayer ? tempoStats.myAverageMs : tempoStats.oppAverageMs;
    return Number.isFinite(ms) && ms > 0 ? ms / 1000 : null;
}

function updateTempoStats(isMyTurn){
    const now = Date.now();
    if(isMyTurn){
        if(tempoStats.lastIsMyTurn !== true){
            tempoStats.myTurnStartedAt = now;
            if(tempoStats.oppTurnStartedAt){
                const oppSample = now - tempoStats.oppTurnStartedAt;
                tempoStats.oppAverageMs = updateMovingAverage(tempoStats.oppAverageMs, oppSample);
                tempoStats.oppTurnStartedAt = null;
            }
        }
    } else {
        if(tempoStats.lastIsMyTurn !== false){
            tempoStats.oppTurnStartedAt = now;
            if(tempoStats.myTurnStartedAt){
                const mySample = now - tempoStats.myTurnStartedAt;
                tempoStats.myAverageMs = updateMovingAverage(tempoStats.myAverageMs, mySample);
                tempoStats.myTurnStartedAt = null;
            }
        }
    }
    tempoStats.lastIsMyTurn = isMyTurn;
}

function normalizeEngineScore(type, value){
    if(type === 'mate'){
        if(!Number.isFinite(value)){
            return null;
        }
        const sign = value > 0 ? 1 : -1;
        const magnitude = Math.max(0, 12 - Math.min(12, Math.abs(value)));
        return sign * (1000 + magnitude * 50);
    }
    return Number.isFinite(value) ? value : null;
}

function ensureEvaluationBarStyle() {
    if (document.getElementById('sf-eval-style')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'sf-eval-style';
    style.textContent = `
#sf-eval-root{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;height:100%;padding:6px 0;font-family:'Segoe UI',Roboto,sans-serif;color:#111;}
#sf-eval-root.sf-eval-dark{color:#fff;}
#sf-eval-root .sf-eval-bar{position:relative;width:28px;flex:1 1 auto;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;background:#888;box-shadow:0 0 0 1px rgba(0,0,0,0.35);transition:box-shadow 0.2s ease;}
#sf-eval-root.sf-eval-thinking .sf-eval-bar{box-shadow:0 0 0 1px rgba(255,180,70,0.65),0 0 12px rgba(255,180,70,0.35);}
#sf-eval-root .sf-eval-fill{width:100%;transition:height 0.18s ease;}
#sf-eval-root .sf-eval-fill.sf-eval-black{background:#262421;}
#sf-eval-root .sf-eval-fill.sf-eval-white{background:#ffffff;}
#sf-eval-root.sf-player-black .sf-eval-bar{flex-direction:column-reverse;}
#sf-eval-root .sf-eval-pointer{position:absolute;left:50%;transform:translate(-50%,-50%);width:22px;height:2px;border-radius:1px;background:#ff5252;box-shadow:0 0 6px rgba(255,82,82,0.55);transition:top 0.18s ease;}
#sf-eval-root .sf-eval-score-container{position:absolute;left:0;right:0;display:flex;justify-content:center;transition:all 0.18s ease;z-index:5;}
#sf-eval-root .sf-eval-score-container.sf-score-top{top:4px;bottom:auto;}
#sf-eval-root .sf-eval-score-container.sf-score-bottom{bottom:4px;top:auto;}
#sf-eval-root .sf-eval-score{font-weight:600;min-width:28px;font-size:11px;padding:2px 4px;border-radius:2px;transition:all 0.2s ease;text-align:center;}
#sf-eval-root .sf-eval-score.sf-score-light{color:#000;background:rgba(255,255,255,0.95);}
#sf-eval-root .sf-eval-score.sf-score-dark{color:#fff;background:rgba(38,36,33,0.95);}
`;
    document.head.appendChild(style);
}

function ensureEvaluationBarRoot(){
    const host = document.getElementById('board-layout-evaluation');
    if(!host){
        return null;
    }
    ensureEvaluationBarStyle();
    let root = document.getElementById('sf-eval-root');
    if(!root || !host.contains(root)){
        if(!root){
            host.textContent = '';
            root = document.createElement('div');
            root.id = 'sf-eval-root';
            root.className = 'sf-eval-root';
            root.innerHTML = `
<div class="sf-eval-bar">
    <div class="sf-eval-fill sf-eval-black" style="height:50%;"></div>
    <span class="sf-eval-pointer" style="top:50%;"></span>
    <div class="sf-eval-fill sf-eval-white" style="height:50%;"></div>
    <div class="sf-eval-score-container sf-score-bottom">
        <span class="sf-eval-score sf-score-light"></span>
    </div>
</div>
`;
        }
        host.appendChild(root);
    }
    return root;
}

function computeWhiteCentipawns(){
    if(!evaluationState.type || !Number.isFinite(evaluationState.value)){
        return null;
    }
    const multiplier = searchContext.sideToMove === 'w' ? 1 : -1;
    if(evaluationState.type === 'mate'){
        let mateValue = evaluationState.value;
        if(mateValue === 0){
            // "mate 0" means the side to move is already checkmated.
            mateValue = -1;
        }
        const sign = mateValue * multiplier;
        return sign > 0 ? 1000 : -1000;
    }
    return evaluationState.value * multiplier;
}

function centipawnsToWinFraction(cp){
    if(cp === null || !isFinite(cp)){
        return 0.5;
    }
    if(evaluationState.type === 'mate'){
        return cp > 0 ? 1.0 : 0.0;
    }
    const clamped = clamp(cp, -10000, 10000);
    const evalPawns = clamped / 100;
    const adjustedEval = Math.sign(evalPawns) * Math.pow(Math.abs(evalPawns), 0.85);
    return 0.5 + 0.5 * Math.tanh(adjustedEval / 4);
}

function formatEvaluationScoreText() {
    const cpWhite = computeWhiteCentipawns();
    if (cpWhite === null) {
        return '…';
    }
    if (evaluationState.type === 'mate' && Number.isFinite(evaluationState.value)) {
        const multiplier = searchContext.sideToMove === 'w' ? 1 : -1;
        const mateForWhite = evaluationState.value * multiplier;
        const moves = Math.abs(mateForWhite);
        return `M${moves}`;
    }
    const absCp = Math.abs(cpWhite);
    const decimals = absCp < 100 ? 2 : absCp < 1000 ? 1 : 0;
    return (absCp / 100).toFixed(decimals);
}

function getAdvantage(playerColor) {
    const cpWhite = computeWhiteCentipawns();
    if (cpWhite === null) {
        return 'equal';
    }
    const cpForPlayer = playerColor === 'white' ? cpWhite : -cpWhite;
    if (cpForPlayer > 10) return 'me';
    if (cpForPlayer < -10) return 'opponent';
    return 'equal';
}

function updateEvaluationBarDisplay() {
    const root = ensureEvaluationBarRoot();
    if (!root) {
        return;
    }
    
    const isDark = document.body && document.body.classList && document.body.classList.contains('theme-dark');
    root.classList.toggle('sf-eval-dark', !!isDark);
    root.classList.toggle('sf-eval-thinking', typeof isThinking !== 'undefined' && isThinking === true);
    
    const playerColor = confirmedPlayerColor || getPlayerColor();
    root.classList.toggle('sf-player-black', playerColor === 'black');
    
    const scoreEl = root.querySelector('.sf-eval-score');
    const scoreContainer = root.querySelector('.sf-eval-score-container');
    const whiteFill = root.querySelector('.sf-eval-white');
    const blackFill = root.querySelector('.sf-eval-black');
    const pointer = root.querySelector('.sf-eval-pointer');

    if (!isInActiveGame || !evaluationState.type) {
        if (scoreEl) { scoreEl.textContent = ''; }
        if (whiteFill) { whiteFill.style.height = '50%'; }
        if (blackFill) { blackFill.style.height = '50%'; }
        if (pointer) { pointer.style.top = '50%'; }
        if (scoreContainer) { 
            scoreContainer.classList.remove('sf-score-top', 'sf-score-bottom');
        }
        if (scoreEl) {
            scoreEl.classList.remove('sf-score-light', 'sf-score-dark');
        }
        return;
    }

    const cpWhite = computeWhiteCentipawns();
    const fraction = centipawnsToWinFraction(cpWhite);
    const whitePercent = clamp(Math.round(fraction * 1000) / 10, 0, 100);
    const blackPercent = clamp(100 - whitePercent, 0, 100);
    
    const advantage = getAdvantage(playerColor);

    if (scoreEl) {
        scoreEl.textContent = formatEvaluationScoreText();
        scoreEl.title = '';
    }
    
    if (scoreContainer && scoreEl) {
        if (advantage === 'opponent') {
            scoreContainer.classList.add('sf-score-top');
            scoreContainer.classList.remove('sf-score-bottom');
            if (playerColor === 'white') {
                scoreEl.classList.add('sf-score-dark');
                scoreEl.classList.remove('sf-score-light');
            } else {
                scoreEl.classList.add('sf-score-light');
                scoreEl.classList.remove('sf-score-dark');
            }
        } else {
            scoreContainer.classList.add('sf-score-bottom');
            scoreContainer.classList.remove('sf-score-top');
            if (playerColor === 'white') {
                scoreEl.classList.add('sf-score-light');
                scoreEl.classList.remove('sf-score-dark');
            } else {
                scoreEl.classList.add('sf-score-dark');
                scoreEl.classList.remove('sf-score-light');
            }
        }
    }
    
    if (whiteFill) { whiteFill.style.height = `${whitePercent}%`; }
    if (blackFill) { blackFill.style.height = `${blackPercent}%`; }
    
    if (pointer) {
        if (playerColor === 'black') {
            pointer.style.top = `${whitePercent}%`;
        } else {
            pointer.style.top = `${blackPercent}%`;
        }
    }
}

function resetEvaluationState() {
    evaluationState.type = null;
    evaluationState.value = null;
    evaluationState.depth = null;
    evaluationState.updatedAt = 0;
    isInActiveGame = false;
    confirmedPlayerColor = null;
    updateEvaluationBarDisplay();
}

function handleEngineInfoLine(message){
    if(typeof message !== 'string'){
        return;
    }
    const nodesMatch = message.match(/\bnodes\s+(\d+)/);
    if(nodesMatch){
        engineMetrics.nodes = parseInt(nodesMatch[1], 10);
    }
    const npsMatch = message.match(/\bnps\s+(\d+)/);
    if(npsMatch){
        engineMetrics.nps = parseInt(npsMatch[1], 10);
    }
    const selDepthMatch = message.match(/\bseldepth\s+(\d+)/);
    if(selDepthMatch){
        engineMetrics.seldepth = parseInt(selDepthMatch[1], 10);
    }
    if(!message.includes('score')){
        return;
    }
    let nextType = null;
    let nextValue = null;
    const mateMatch = message.match(/score\s+mate\s+(-?\d+)/);
    if(mateMatch){
        nextType = 'mate';
        nextValue = parseInt(mateMatch[1], 10);
    } else {
        const cpMatch = message.match(/score\s+cp\s+(-?\d+)/);
        if(cpMatch){
            nextType = 'cp';
            nextValue = parseInt(cpMatch[1], 10);
        }
    }
    const multiPvMatch = message.match(/\bmultipv\s+(\d+)/);
    if(multiPvMatch && parseInt(multiPvMatch[1], 10) !== 1){
        return;
    }
    if(nextType === null || !Number.isFinite(nextValue)){
        return;
    }
    const depthMatch = message.match(/\bdepth\s+(\d+)/);
    evaluationState.type = nextType;
    evaluationState.value = nextValue;
    evaluationState.depth = depthMatch ? parseInt(depthMatch[1], 10) : evaluationState.depth;
    evaluationState.updatedAt = Date.now();

    const normalizedScore = normalizeEngineScore(nextType, nextValue);
    const previousScore = normalizeEngineScore(engineMetrics.lastScoreType, engineMetrics.lastScoreValue);
    if(normalizedScore !== null){
        if(previousScore !== null){
            const delta = Math.abs(normalizedScore - previousScore);
            engineMetrics.volatility = updateMovingAverage(engineMetrics.volatility, delta, 0.3);
        } else {
            engineMetrics.volatility = updateMovingAverage(engineMetrics.volatility, Math.abs(normalizedScore) * 0.1, 0.3);
        }
        engineMetrics.lastScoreType = nextType;
        engineMetrics.lastScoreValue = nextValue;
        engineMetrics.lastScoreTime = Date.now();
    }
    updateEvaluationBarDisplay();
}

resetEvaluationState();

function ensureStockfishWorkerURL() {
    if(stockfishWorkerURLPromise){
        return stockfishWorkerURLPromise;
    }
    const stockfishScriptURL = `${STOCKFISH_BASE_URL}${STOCKFISH_MAIN_SCRIPT}`;
    
    stockfishWorkerURLPromise = fetch(stockfishScriptURL)
        .then(response => {
            if(!response.ok){
                stockfishWorkerURLPromise = null;
                throw new Error(`Unable to download Stockfish script (${response.status})`);
            }
            return response.text();
        })
        .then(bootstrapSource => {
            if(!bootstrapSource.includes(STOCKFISH_BOOTSTRAP_PATTERN)){
                stockfishWorkerURLPromise = null;
                throw new Error('Unexpected Stockfish bootstrap format.');
            }
            bootstrapSource = bootstrapSource.replace(
                STOCKFISH_BOOTSTRAP_PATTERN,
                `a='${STOCKFISH_WASM_URL}'`
            );
            const prelude = `
self.Module = self.Module || {};
self.Module.locateFile = self.Module.locateFile || function(path) {
    return '${STOCKFISH_BASE_URL}' + path;
};
`;
            const blob = new Blob([prelude, bootstrapSource], {type: 'application/javascript'});
            return URL.createObjectURL(blob);
        })
        .catch(error => {
            stockfishWorkerURLPromise = null;
            console.error('Failed to fetch Stockfish script:', error);
            throw error;
        });
    
    return stockfishWorkerURLPromise;
}

function parseClockText(text){
    if(typeof text !== 'string'){
        return null;
    }
    const segments = text.trim().split(':').filter(Boolean);
    if(segments.length === 0){
        return null;
    }
    let totalSeconds = 0;
    let multiplier = 1;
    for(let i = segments.length - 1; i >= 0; i--){
        const segment = segments[i];
        const value = i === segments.length - 1 ? parseFloat(segment) : parseInt(segment, 10);
        if(!Number.isFinite(value)){
            continue;
        }
        totalSeconds += value * multiplier;
        multiplier *= 60;
    }
    return totalSeconds || null;
}

function getClockSnapshot(){
    const defaultState = {
        seconds: null,
        isTurn: false,
        color: null
    };
    const snapshot = {
        top: {...defaultState},
        bottom: {...defaultState}
    };

    const topComponent = document.querySelector('.clock-component.clock-top');
    if(topComponent){
        const timeSpan = topComponent.querySelector('.clock-time-monospace');
        snapshot.top.seconds = parseClockText(timeSpan ? timeSpan.textContent : null);
        snapshot.top.isTurn = topComponent.classList.contains('clock-player-turn');
        snapshot.top.color = topComponent.classList.contains('clock-white') ? 'white' :
            topComponent.classList.contains('clock-black') ? 'black' : null;
    }

    const bottomComponent = document.querySelector('.clock-component.clock-bottom');
    if(bottomComponent){
        const timeSpan = bottomComponent.querySelector('.clock-time-monospace');
        snapshot.bottom.seconds = parseClockText(timeSpan ? timeSpan.textContent : null);
        snapshot.bottom.isTurn = bottomComponent.classList.contains('clock-player-turn');
        snapshot.bottom.color = bottomComponent.classList.contains('clock-white') ? 'white' :
            bottomComponent.classList.contains('clock-black') ? 'black' : null;
    }

    return snapshot;
}

function getMoveNumberEstimate(){
    const moveRows = document.querySelectorAll('.main-line-row.move-list-row[data-whole-move-number]');
    if(!moveRows || moveRows.length === 0){
        return 1;
    }
    const lastRow = moveRows[moveRows.length - 1];
    const moveAttribute = lastRow.getAttribute('data-whole-move-number');
    const parsed = parseInt(moveAttribute, 10);
    return Number.isFinite(parsed) ? parsed : 1;
}

function getCapturedMaterialStats(){
    const stats = {
        whiteCaptured: {pieces: 0, value: 0},
        blackCaptured: {pieces: 0, value: 0}
    };
    const valueMap = {
        pawn: 1, pawns: 1,
        knight: 3, knights: 3,
        bishop: 3, bishops: 3,
        rook: 5, rooks: 5,
        queen: 9, queens: 9
    };
    const spans = document.querySelectorAll('.captured-pieces-cpiece');
    spans.forEach(span => {
        if(span.classList.contains('captured-pieces-score')){
            return;
        }
        const className = span.className || '';
        const match = className.match(/captured-pieces-(w|b)-(?:([0-9]+)-)?([a-z]+)/i);
        if(!match){
            return;
        }
        const colorToken = match[1].toLowerCase();
        const count = match[2] ? parseInt(match[2], 10) : 1;
        const pieceToken = match[3] ? match[3].toLowerCase() : '';
        const pieceValue = valueMap[pieceToken];
        if(!Number.isFinite(count) || !Number.isFinite(pieceValue)){
            return;
        }
        if(colorToken === 'w'){
            stats.whiteCaptured.pieces += count;
            stats.whiteCaptured.value += pieceValue * count;
        } else if(colorToken === 'b'){
            stats.blackCaptured.pieces += count;
            stats.blackCaptured.value += pieceValue * count;
        }
    });
    stats.totalPieces = stats.whiteCaptured.pieces + stats.blackCaptured.pieces;
    stats.totalValue = stats.whiteCaptured.value + stats.blackCaptured.value;
    return stats;
}

function estimateGamePhase(moveNumber, captureStats){
    const totalValue = captureStats ? captureStats.totalValue : 0;
    if(moveNumber <= 12 && totalValue < 6){
        return 'opening';
    }
    if(moveNumber >= 35 || totalValue > 20){
        return 'endgame';
    }
    return 'middlegame';
}

function getPhaseBaseLookup(timeControlMinutes){
    const minutes = Number.isFinite(timeControlMinutes) ? timeControlMinutes : 3;
    if(minutes <= 1.5){
        return {
            opening: 0.35,
            middlegame: 0.7,
            endgame: 1.1
        };
    }
    if(minutes <= 3.5){
        return {
            opening: 0.75,
            middlegame: 1.8,
            endgame: 2.7
        };
    }
    if(minutes <= 7.5){
        return {
            opening: 0.95,
            middlegame: 2.4,
            endgame: 3.4
        };
    }
    return {
        opening: 1.2,
        middlegame: 3.2,
        endgame: 4.6
    };
}

function computeHumanDelay(context){
    const {
        myTime,
        oppTime,
        phase,
        moveNumber,
        captureStats,
        playingAs,
        minBound,
        maxBound,
        timeControlMinutes,
        playerTempo,
        opponentTempo,
        engineVolatility,
        engineSpeed,
        engineDepth,
        evaluationType,
        evaluationValue
    } = context;

    const baseLookup = getPhaseBaseLookup(timeControlMinutes);
    const basePhaseDelay = baseLookup[phase] || 1.5;
    let delay = basePhaseDelay;

    if(Number.isFinite(moveNumber) && moveNumber <= 6){
        delay *= 0.85;
    }

    if(Number.isFinite(myTime)){
        if(myTime < 15){
            delay *= 0.25;
        } else if(myTime < 30){
            delay *= 0.4;
        } else if(myTime < 60){
            delay *= 0.65;
        } else if(myTime > 240){
            delay *= 1.15;
        }
    }

    if(Number.isFinite(myTime) && Number.isFinite(oppTime)){
        const ratio = oppTime > 0 ? myTime / oppTime : 1;
        if(ratio < 0.75){
            delay *= 0.85;
        } else if(ratio > 1.5){
            delay *= 1.1;
        }
    }

    let materialSwing = 0;
    if(captureStats && playingAs){
        const myCaptured = playingAs === 'white' ? captureStats.blackCaptured.value : captureStats.whiteCaptured.value;
        const oppCaptured = playingAs === 'white' ? captureStats.whiteCaptured.value : captureStats.blackCaptured.value;
        materialSwing = myCaptured - oppCaptured;
    }
    if(materialSwing > 3){
        delay *= 1.1;
    } else if(materialSwing < -3){
        delay *= 0.9;
    }

    if(Number.isFinite(playerTempo)){
        const tempoRatio = clamp(playerTempo / Math.max(0.25, basePhaseDelay), 0.3, 3);
        if(tempoRatio > 1.1){
            delay *= 1 + Math.min(tempoRatio - 1, 0.8) * 0.35;
        } else if(tempoRatio < 0.9){
            delay *= 1 - Math.min(1 - tempoRatio, 0.6) * 0.4;
        }
    }

    if(Number.isFinite(opponentTempo)){
        if(opponentTempo < basePhaseDelay * 0.7){
            delay *= 0.9;
        } else if(opponentTempo > basePhaseDelay * 1.7){
            delay *= 1.08;
        }
    }

    if(Number.isFinite(engineVolatility)){
        if(engineVolatility > 600){
            delay *= 1.2;
        } else if(engineVolatility < 120){
            delay *= 0.95;
        }
    }

    if(evaluationType === 'mate' && Number.isFinite(evaluationValue)){
        delay *= evaluationValue > 0 ? 0.75 : 0.6;
    }

    if(Number.isFinite(engineDepth) && engineDepth >= 26){
        delay *= 0.92;
    }

    if(Number.isFinite(engineSpeed) && engineSpeed > 1500000){
        delay *= 0.95;
    }

    const spread = Math.max(0.05, delay * 0.25);
    delay += (Math.random() - 0.5) * spread;
    delay += Math.random() * spread * 0.25;

    const lowerBound = Number.isFinite(minBound) ? Math.max(0.1, minBound) : 0.3;
    const upperBound = Number.isFinite(maxBound) ? Math.max(lowerBound, maxBound) : 6;

    if(!Number.isFinite(delay) || delay <= 0){
        delay = lowerBound;
    }

    delay = Math.max(lowerBound, Math.min(upperBound, delay));
    return delay;
}

function main() {
    let stockfishObjectURL = null;
    const engine = document.engine = {};
    const myVars = document.myVars = {
        autoRun: false,
        autoMove: false,
        evalOnly: false,
        autoNewGame: false,
        delay: 0.1,
        lastAutoNewGame: 0,
        detectedTimeControl: null,
        playingAs: null,
        isThinking: false
    };
    const myFunctions = document.myFunctions = {};
    let lastValue = DEFAULT_DEPTH;
    let loaded = false;
    let adRemoved = false;
    
    function resolveCurrentFen() {
        if(board && board.game && typeof board.game.getFEN === 'function'){
            try{
                return board.game.getFEN();
            } catch (error){
                console.warn('Unable to read FEN from board.game', error);
            }
        }
        
        try {
            const game = board?.game || window.game;
            if (game && typeof game.getFEN === 'function') {
                return game.getFEN();
            }
        } catch (e) {}
        
        try {
            const boardEl = document.querySelector('wc-chess-board') || document.querySelector('chess-board');
            if (boardEl && boardEl.game && typeof boardEl.game.getFEN === 'function') {
                return boardEl.game.getFEN();
            }
        } catch (e) {}
        
        return null;
    }

    function getBoardElement(){
        return $('chess-board')[0] || $('wc-chess-board')[0];
    }

    function convertSquareNotation(square){
        const col = square.charAt(0);
        return (COL_TO_NUM[col] || col) + square.charAt(1);
    }

    function createSquareHighlight(square){
        const highlightHtml = `<div class="highlight square-${square} bro" style="background-color: ${HIGHLIGHT_COLOR}; opacity: ${HIGHLIGHT_OPACITY};" data-test-element="highlight"></div>`;
        $(board.nodeName)
            .prepend(highlightHtml)
            .children(':first')
            .delay(HIGHLIGHT_DURATION_MS)
            .queue(function() {
                $(this).remove();
            });
    }

    myFunctions.color = function(moveData){
        if(myVars.evalOnly){
            return;
        }
        const fromSquare = moveData.substring(0, 2);
        const toSquare = moveData.substring(2, 4);

        if(myVars.autoMove){
            myFunctions.movePiece(fromSquare, toSquare);
        }
        isThinking = false;

        const fromConverted = convertSquareNotation(fromSquare);
        const toConverted = convertSquareNotation(toSquare);
        createSquareHighlight(toConverted);
        createSquareHighlight(fromConverted);
    }

    myFunctions.movePiece = function(from, to){
        if(!board || !board.game || typeof board.game.getLegalMoves !== 'function'){
            return;
        }
        
        const legalMoves = board.game.getLegalMoves();
        const matchingMove = legalMoves.find(move => move.from === from && move.to === to);
        
        if(matchingMove){
            board.game.move({
                ...matchingMove,
                promotion: 'false',
                animate: false,
                userGenerated: true
            });
        }
    }

    function parser(e){
        const message = typeof e.data === 'string' ? e.data : '';
        if(message.startsWith('info ')){
            handleEngineInfoLine(message);
            return;
        }
        if(message.includes('bestmove')){
            const tokens = message.split(' ');
            const moveToken = tokens.length > 1 ? tokens[1] : '';
            if(!myVars.evalOnly){
                console.log('Best move:', moveToken);
                myFunctions.color(moveToken);
            }
            isThinking = false;
            updateEvaluationBarDisplay();
        }
    }

    function spawnStockfishEngine(url){
        engine.engine = new Worker(url);
        engine.engine.onmessage = e => {
            parser(e);
        };
        engine.engine.onerror = e => {
            console.log("Worker Error: "+e);
        };
        engine.engine.postMessage('setoption name Threads value 1');
        engine.engine.postMessage('ucinewgame');
        console.log('loaded chess engine');
    }

    myFunctions.reloadChessEngine = function() {
        console.log(`Reloading the chess engine!`);

        if(engine.engine){
            engine.engine.terminate();
            engine.engine = null;
        }
        if(stockfishObjectURL){
            URL.revokeObjectURL(stockfishObjectURL);
            stockfishObjectURL = null;
        }
        stockfishWorkerURLPromise = null;
        isThinking = false;
        resetEvaluationState();
        myFunctions.loadChessEngine();
    }

    myFunctions.loadChessEngine = function() {
        if(engine.engine){
            return;
        }
        ensureStockfishWorkerURL()
            .then(url => {
                if(engine.engine){
                    return;
                }
                stockfishObjectURL = url;
                spawnStockfishEngine(stockfishObjectURL);
            })
            .catch(error => {
                console.error('Failed to initialise Stockfish engine:', error);
            });
    }

    myFunctions.runChessEngine = function(depth){
        const fen = resolveCurrentFen();
        if(!fen){
            console.warn('No FEN available to send to Stockfish.');
            return;
        }
        engine.engine.postMessage(`position fen ${fen}`);
        console.log('Position updated:', fen);
        isThinking = true;
        engine.engine.postMessage(`go depth ${depth}`);
        lastValue = depth;
        const fenTokens = fen.split(/\s+/);
        searchContext.sideToMove = fenTokens[1] || 'w';
        updateEvaluationBarDisplay();
    }

    myFunctions.autoRun = function(depth){
        if(board && board.game && typeof board.game.getTurn === 'function' && typeof board.game.getPlayingAs === 'function' && board.game.getTurn() === board.game.getPlayingAs()){
            myFunctions.runChessEngine(depth);
        }
    }

    function handleDepthHotkeys(event){
        if(event.defaultPrevented) return;
        
        const target = event.target;
        if(target){
            const tag = (target.tagName || '').toUpperCase();
            if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable){
                return;
            }
        }
        
        const depth = DEPTH_HOTKEYS[event.keyCode];
        if(depth !== undefined){
            myFunctions.runChessEngine(depth);
            event.preventDefault();
        }
    }
    ROOT_WINDOW.addEventListener('keydown', handleDepthHotkeys, true);

    myFunctions.spinner = function() {
        if(isThinking == true){
            $('#overlay')[0].style.display = 'flex';
        }
        if(isThinking == false) {
            $('#overlay')[0].style.display = 'none';
        }
        const evalRoot = document.getElementById('sf-eval-root');
        if(evalRoot){
            evalRoot.classList.toggle('sf-eval-thinking', isThinking === true);
        }
    }

    myFunctions.removeAdSlot = function(){
        if(adRemoved) return;
        try {
            const adContainer = $('#sky-atf')[0];
            if(adContainer && adContainer.children.length > 0){
                adContainer.innerHTML = '';
                adRemoved = true;
            }
        } catch (err) {
            console.log('Error removing ad slot:', err);
        }
    }

    myFunctions.handleAutoNewGame = function(){
        if(!myVars.autoNewGame) return;
        
        const now = Date.now();
        const AUTO_NEW_GAME_COOLDOWN = 5000;
        
        if(myVars.lastAutoNewGame && (now - myVars.lastAutoNewGame) < AUTO_NEW_GAME_COOLDOWN) return;
        
        const buttons = Array.from(document.querySelectorAll('button.game-over-buttons-button'));
        let targetButton = buttons.find(btn => {
            if(!btn || btn.disabled) return false;
            const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if(!text) return false;
            return /new|min|mới|phút|1|3|5|10/.test(text);
        });
        
        if(!targetButton){
            targetButton = buttons.find(btn => btn && !btn.disabled);
        }
        
        if(targetButton){
            targetButton.click();
            myVars.lastAutoNewGame = now;
        }
    }

    myFunctions.loadEx = function() {
        try{
            board = getBoardElement();
            myVars.board = board;
            const anchorElement = board && board.parentElement ? (board.parentElement.parentElement || board.parentElement) : document.body;

            const existingRoot = document.getElementById('sf-control-root');
            if(existingRoot){
                existingRoot.remove();
            }

            if(!document.getElementById('sf-control-style')){
                const styleEl = document.createElement('style');
                styleEl.id = 'sf-control-style';
                styleEl.textContent = `
#sf-control-root{position:fixed;bottom:20px;right:20px;z-index:2147483646;font-family:'Segoe UI',Roboto,sans-serif;}
#sf-control-root .sf-toggle{width:56px;height:56px;border-radius:50%;border:none;background-image:url('data:image/png;base64,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');background-size:cover;background-position:center;background-repeat:no-repeat;color:#fff;font-weight:600;font-size:18px;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,0.25);transition:transform 0.15s ease,box-shadow 0.15s ease;}
#sf-control-root .sf-toggle:hover{transform:translateY(-2px);box-shadow:0 12px 24px rgba(0,0,0,0.3);}
#sf-control-root.sf-open .sf-toggle{box-shadow:0 12px 28px rgba(0,0,0,0.35);}
#sf-control-root .sf-panel{position:absolute;bottom:70px;right:0;width:300px;max-width:calc(100vw - 40px);background:#ffffff;border-radius:14px;box-shadow:0 12px 28px rgba(0,0,0,0.28);padding:16px;opacity:0;pointer-events:none;transform:translateY(12px) scale(0.98);transition:opacity 0.2s ease,transform 0.2s ease;}
#sf-control-root.sf-open .sf-panel{opacity:1;pointer-events:auto;transform:translateY(0) scale(1);}
#sf-control-root .sf-panel-content{display:flex;flex-direction:column;gap:10px;}
#sf-control-root .sf-panel-header{margin-bottom:6px;}
#sf-control-root .sf-depth{margin:0;font-weight:600;}
#sf-control-root .sf-hint{margin:4px 0 0;font-size:12px;color:#555;}
#sf-control-root .sf-row{display:flex;align-items:center;gap:8px;margin:4px 0;}
#sf-control-root .sf-row.sf-row--checkbox{flex-direction:row;}
#sf-control-root .sf-row.sf-row--field{flex-direction:column;align-items:flex-start;}
#sf-control-root .sf-row label{font-size:13px;color:#222;cursor:pointer;}
#sf-control-root .sf-row input[type="number"]{width:100%;padding:4px 6px;border:1px solid #ccc;border-radius:6px;font-size:13px;}
#sf-control-root .sf-panel-footer{margin-top:12px;display:flex;justify-content:center;}
#sf-control-root .sf-button{background:#3cba2c;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;transition:background 0.2s ease,transform 0.1s ease;}
#sf-control-root .sf-button:hover{background:#2d8f20;}
#sf-control-root .sf-button:active{transform:translateY(1px);}
#sf-control-root .sf-overlay{display:none;position:absolute;inset:0;background:rgba(255,255,255,0.8);border-radius:14px;align-items:center;justify-content:center;}
#sf-control-root .sf-overlay .sf-spinner{width:40px;height:40px;border:4px solid #3cba2c;border-top-color:transparent;border-radius:50%;animation:sf-rotate 0.8s linear infinite;}
@keyframes sf-rotate{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
`;
                document.head.appendChild(styleEl);
            }

            const root = document.createElement('div');
            root.id = 'sf-control-root';

            const toggle = document.createElement('button');
            toggle.id = 'sf-toggle';
            toggle.type = 'button';
            toggle.className = 'sf-toggle';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-controls', 'sf-panel');
            toggle.setAttribute('aria-label', 'Toggle Stockfish controls');
            toggle.textContent = '';

            const panel = document.createElement('div');
            panel.id = 'sf-panel';
            panel.className = 'sf-panel';
    panel.innerHTML = `
<div id="overlay" class="sf-overlay" style="display:none;">
    <div class="sf-spinner"></div>
</div>
<div class="sf-panel-content">
    <div class="sf-panel-header">
        <p id="depthText" class="sf-depth">Your Current Depth Is: 11</p>
        <p class="sf-hint">Press a key on your keyboard to change this!</p>
    </div>
    <div class="sf-row sf-row--checkbox">
        <input type="checkbox" id="autoRun" name="autoRun" value="false">
        <label for="autoRun">Enable auto run</label>
    </div>
    <div class="sf-row sf-row--checkbox">
        <input type="checkbox" id="evalOnly" name="evalOnly" value="false">
        <label for="evalOnly">Eval bar only (no move hints)</label>
    </div>
    <div class="sf-row sf-row--checkbox">
        <input type="checkbox" id="autoMove" name="autoMove" value="false">
        <label for="autoMove">Enable auto move</label>
    </div>
    <div class="sf-row sf-row--field">
        <label for="timeDelayMin">Auto Run Delay Minimum (Seconds)</label>
        <input type="number" id="timeDelayMin" name="timeDelayMin" min="0.1" value="0.1">
    </div>
    <div class="sf-row sf-row--field">
        <label for="timeDelayMax">Auto Run Delay Maximum (Seconds)</label>
        <input type="number" id="timeDelayMax" name="timeDelayMax" min="0.1" value="1">
    </div>
    <div class="sf-row sf-row--checkbox">
        <input type="checkbox" id="autoNewGame" name="autoNewGame" value="false">
        <label for="autoNewGame">Enable auto new game</label>
    </div>
</div>
<div class="sf-panel-footer">
    <button type="button" id="relEngBut" class="sf-button" onclick="document.myFunctions.reloadChessEngine()">Reload Chess Engine</button>
</div>
`;

            root.appendChild(toggle);
            root.appendChild(panel);
            anchorElement.appendChild(root);

            toggle.addEventListener('click', () => {
                const isOpen = root.classList.toggle('sf-open');
                toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });

            loaded = true;
        } catch (error) {
            console.error('Error loading extension UI:', error);
        }
    };

    function delay(minS, maxS) {
        return new Promise(resolve => {
            const min = Math.min(minS, maxS);
            const max = Math.max(minS, maxS);
            const delayMs = (Math.random() * (max - min) + min) * 1000;
            setTimeout(resolve, delayMs);
        });
    }

    const waitForChessBoard = setInterval(async () => {
        const gameBoard = document.querySelector('chess-board') || document.querySelector('wc-chess-board');
        if (!gameBoard) return;

        clearInterval(waitForChessBoard);
        board = gameBoard;

        myFunctions.loadEx();
        myFunctions.loadChessEngine();

        while (true) {
            try {
                if (!extensionEnabled) {
                    await delay(0.5, 1);
                    continue;
                }
                
                updateEvaluationBarDisplay();
                
                if (loaded) {
                    board = getBoardElement();
                    
                    const autoRunCheckbox = $('#autoRun')[0];
                    const evalOnlyCheckbox = $('#evalOnly')[0];
                    const autoMoveCheckbox = $('#autoMove')[0];
                    const depthText = $('#depthText')[0];

                    if (autoRunCheckbox) myVars.autoRun = autoRunCheckbox.checked;
                    if (evalOnlyCheckbox) myVars.evalOnly = evalOnlyCheckbox.checked;
                    if (autoMoveCheckbox) myVars.autoMove = autoMoveCheckbox.checked;
                    if (autoMoveCheckbox) {
                        autoMoveCheckbox.disabled = !!myVars.evalOnly;
                        if (myVars.evalOnly) {
                            autoMoveCheckbox.checked = false;
                            myVars.autoMove = false;
                        }
                    }

                    if (board && board.game && typeof board.game.getPlayingAs === 'function') {
                        const detectedColor = board.game.getPlayingAs();
                        myVars.playingAs = detectedColor;
                        
                        if (detectedColor && typeof board.game.getFEN === 'function') {
                            const fen = board.game.getFEN();
                            if (fen && fen !== STARTING_FEN) {
                                isInActiveGame = true;
                                confirmedPlayerColor = detectedColor === 1 ? 'white' : (detectedColor === 2 ? 'black' : detectedColor);
                            }
                        }
                    }

                    const clocks = getClockSnapshot();
                    const playingAs = myVars.playingAs || clocks.bottom.color || 'white';

                    if (board && board.game && typeof board.game.getTurn === 'function' && typeof board.game.getPlayingAs === 'function') {
                        myTurn = board.game.getTurn() === board.game.getPlayingAs();
                    } else if (playingAs === clocks.bottom.color) {
                        myTurn = clocks.bottom.isTurn;
                    } else if (playingAs === clocks.top.color) {
                        myTurn = clocks.top.isTurn;
                    } else {
                        myTurn = clocks.bottom.isTurn;
                    }

                    updateTempoStats(Boolean(myTurn));

                    if (depthText) {
                        depthText.innerHTML = `Your Current Depth Is: <strong>${lastValue}</strong>`;
                    }

                    myVars.isThinking = isThinking;
                    if (typeof myFunctions.spinner === 'function') {
                        myFunctions.spinner();
                    }

                    const shouldAutoRun = ROOT_WINDOW.document.getElementById("autoRun")?.checked || myVars.evalOnly;
                    if (canGo && !isThinking && myTurn && shouldAutoRun) {
                        const minDelayVal = parseFloat(ROOT_WINDOW.document.getElementById("timeDelayMin")?.value) || 0.1;
                        const maxDelayVal = parseFloat(ROOT_WINDOW.document.getElementById("timeDelayMax")?.value) || 1;
                        await delay(minDelayVal, maxDelayVal);
                        myFunctions.runChessEngine(lastValue);
                    }

                    myFunctions.handleAutoNewGame();
                } else {
                    myFunctions.loadEx();
                }

                await delay(0.1, 0.2);
            } catch (err) { 
                console.error('Main loop error:', err); 
            }
        }
    }, 1000);
}

ROOT_WINDOW.addEventListener('load', main);

}
