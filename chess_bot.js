// ==UserScript==
// @name         Chess.com Bot (Single Thread Stockfish 17.1)
// @namespace    chess
// @version      1.8.3.6-single
// @description  Chess.com Bot that finds the best move!
// @match       https://www.chess.com/play/*
// @match       https://www.chess.com/game/*
// @match       https://www.chess.com/puzzles/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_registerMenuCommand
// @connect     cdn.jsdelivr.net
// @require     https://greasyfork.org/scripts/445697/code/index.js
// @require     https://code.jquery.com/jquery-3.6.0.min.js
// @run-at      document-start
// ==/UserScript==

//Don't touch anything below unless you know what your doing!

const ROOT_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

const currentVersion = '1.8.3.6-single'; // Sets the current version
const STOCKFISH_BASE_URL = 'https://cdn.jsdelivr.net/gh/dodaonam/stockfish.js@main/171_single_nnue/';
const STOCKFISH_MAIN_SCRIPT = 'stockfish-17.1-single-a496a04.js';
const STOCKFISH_WASM_URL = `${STOCKFISH_BASE_URL}stockfish-17.1-single-a496a04.wasm`;
const STOCKFISH_BOOTSTRAP_PATTERN = 'a=decodeURIComponent(e[0]||location.origin+location.pathname.replace(/\\.js$/i,".wasm"))';
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

function getPlayerColor(){
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

function ensureEvaluationBarStyle(){
    if(document.getElementById('sf-eval-style')){
        return;
    }
    const style = document.createElement('style');
    style.id = 'sf-eval-style';
    style.textContent = `
#sf-eval-root{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;height:100%;padding:6px 0;font-family:'Segoe UI',Roboto,sans-serif;color:#111;}
#sf-eval-root.sf-eval-dark{color:#fff;}
#sf-eval-root .sf-eval-bar{position:relative;width:28px;flex:1 1 auto;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,#0b0b0b 0%,#141414 50%,#f4f4f4 50%,#ffffff 100%);box-shadow:0 0 0 1px rgba(0,0,0,0.35);transition:box-shadow 0.2s ease;}
#sf-eval-root.sf-eval-thinking .sf-eval-bar{box-shadow:0 0 0 1px rgba(255,180,70,0.65),0 0 12px rgba(255,180,70,0.35);}
#sf-eval-root.sf-player-black .sf-eval-bar{background:linear-gradient(180deg,#f4f4f4 0%,#ffffff 50%,#0b0b0b 50%,#141414 100%);}
#sf-eval-root .sf-eval-fill{width:100%;transition:height 0.18s ease;}
#sf-eval-root .sf-eval-fill.sf-eval-black{background:#0f0f0f;}
#sf-eval-root .sf-eval-fill.sf-eval-white{background:#f6f6f6;}
#sf-eval-root.sf-player-black .sf-eval-fill.sf-eval-black{background:#f6f6f6;}
#sf-eval-root.sf-player-black .sf-eval-fill.sf-eval-white{background:#0f0f0f;}
#sf-eval-root .sf-eval-pointer{position:absolute;left:50%;transform:translate(-50%,-50%);width:22px;height:2px;border-radius:1px;background:#ff5252;box-shadow:0 0 6px rgba(255,82,82,0.55);transition:top 0.18s ease;}
#sf-eval-root .sf-eval-meta{margin-top:6px;text-align:center;font-size:13px;line-height:1.3;display:flex;flex-direction:column;align-items:center;gap:2px;}
#sf-eval-root .sf-eval-score{font-weight:300;min-width:40px;color:#fff;}
#sf-eval-root .sf-eval-depth{font-size:11px;color:#666;}
#sf-eval-root.sf-eval-dark .sf-eval-depth{color:#ccc;}
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
</div>
<div class="sf-eval-meta">
    <span class="sf-eval-score">—</span>
    <span class="sf-eval-depth"></span>
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
        const sign = evaluationState.value * multiplier;
        if(sign === 0){
            return 0;
        }
        return sign > 0 ? 1000 : -1000;
    }
    return evaluationState.value * multiplier;
}

function computePlayerCentipawns(){
    const cpWhite = computeWhiteCentipawns();
    if(cpWhite === null){
        return null;
    }
    return getPlayerColor() === 'white' ? cpWhite : -cpWhite;
}

function computePlayerMateScore(){
    if(evaluationState.type !== 'mate' || !Number.isFinite(evaluationState.value)){
        return null;
    }
    const sideToMove = searchContext.sideToMove === 'b' ? 'b' : 'w';
    const playerColor = getPlayerColor() === 'black' ? 'b' : 'w';
    const multiplier = sideToMove === playerColor ? 1 : -1;
    return evaluationState.value * multiplier;
}

function centipawnsToWinFraction(cp){
    if(cp === null){
        return 0.5;
    }
    const clamped = clamp(cp, -1500, 1500);
    return 1 / (1 + Math.exp(-clamped / 100));
}

function formatEvaluationScoreText(){
    const mateForPlayer = computePlayerMateScore();
    if(mateForPlayer !== null){
        const moves = Math.abs(mateForPlayer);
        if(moves === 0){
            return 'M0';
        }
        return mateForPlayer > 0 ? `M${moves}` : `-M${moves}`;
    }
    const cp = computePlayerCentipawns();
    if(cp === null){
        return '…';
    }
    const absCp = Math.abs(cp);
    const decimals = absCp < 100 ? 2 : absCp < 1000 ? 1 : 0;
    const formatted = (cp / 100).toFixed(decimals);
    const prefix = cp > 0 ? '+' : '';
    return `${prefix}${formatted}`;
}

function updateEvaluationBarDisplay(){
    const root = ensureEvaluationBarRoot();
    if(!root){
        return;
    }
    const isDark = document.body && document.body.classList && document.body.classList.contains('theme-dark');
    root.classList.toggle('sf-eval-dark', !!isDark);
    root.classList.toggle('sf-eval-thinking', typeof isThinking !== 'undefined' && isThinking === true);
    const playerColor = getPlayerColor();
    root.classList.toggle('sf-player-black', playerColor === 'black');
    const scoreEl = root.querySelector('.sf-eval-score');
    const depthEl = root.querySelector('.sf-eval-depth');
    const whiteFill = root.querySelector('.sf-eval-white');
    const blackFill = root.querySelector('.sf-eval-black');
    const pointer = root.querySelector('.sf-eval-pointer');

    if(!evaluationState.type){
        if(scoreEl){ scoreEl.textContent = '…'; }
        if(depthEl){ depthEl.textContent = ''; }
        if(whiteFill){ whiteFill.style.height = '50%'; }
        if(blackFill){ blackFill.style.height = '50%'; }
        if(pointer){ pointer.style.top = '50%'; }
        return;
    }

    const cpForPlayer = computePlayerCentipawns();
    const fraction = centipawnsToWinFraction(cpForPlayer);
    const playerPercent = clamp(Math.round(fraction * 1000) / 10, 0, 100);
    const opponentPercent = clamp(100 - playerPercent, 0, 100);

    if(scoreEl){
        scoreEl.textContent = formatEvaluationScoreText();
        const mateForPlayer = computePlayerMateScore();
        if(mateForPlayer !== null){
            scoreEl.title = mateForPlayer > 0 ? `Mate for bạn trong ${Math.abs(mateForPlayer)} nước` : `Đối thủ mate trong ${Math.abs(mateForPlayer)} nước`;
        } else {
            scoreEl.title = '';
        }
    }
    if(depthEl){ depthEl.textContent = evaluationState.depth ? `D${evaluationState.depth}` : ''; }
    if(playerColor === 'white'){
        if(whiteFill){ whiteFill.style.height = `${playerPercent}%`; }
        if(blackFill){ blackFill.style.height = `${opponentPercent}%`; }
        if(pointer){ pointer.style.top = `${opponentPercent}%`; }
    } else {
        if(whiteFill){ whiteFill.style.height = `${opponentPercent}%`; }
        if(blackFill){ blackFill.style.height = `${playerPercent}%`; }
        if(pointer){ pointer.style.top = `${playerPercent}%`; }
    }
}

function resetEvaluationState(){
    evaluationState.type = null;
    evaluationState.value = null;
    evaluationState.depth = null;
    evaluationState.updatedAt = 0;
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

function ensureStockfishWorkerURL(){
    if(stockfishWorkerURLPromise){
        return stockfishWorkerURLPromise;
    }
    const stockfishScriptURL = `${STOCKFISH_BASE_URL}${STOCKFISH_MAIN_SCRIPT}`;
    stockfishWorkerURLPromise = new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url: stockfishScriptURL,
            overrideMimeType: 'text/plain',
            onload: response => {
                if(response.status !== 200){
                    stockfishWorkerURLPromise = null;
                    reject(new Error(`Unable to download Stockfish script (${response.status})`));
                    return;
                }
                let bootstrapSource = response.responseText || '';
                if(!bootstrapSource.includes(STOCKFISH_BOOTSTRAP_PATTERN)){
                    stockfishWorkerURLPromise = null;
                    reject(new Error('Unexpected Stockfish bootstrap format.'));
                    return;
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
                resolve(URL.createObjectURL(blob));
            },
            onerror: error => {
                stockfishWorkerURLPromise = null;
                reject(new Error(`Failed to fetch Stockfish script: ${error.error || 'network error'}`));
            }
        });
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
        whiteCaptured: {pieces: 0, value: 0}, // white pieces captured by black
        blackCaptured: {pieces: 0, value: 0}  // black pieces captured by white
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

    var stockfishObjectURL;
    var engine = document.engine = {};
    var myVars = document.myVars = {};
    myVars.autoRun = false;
    myVars.delay = 0.1;
    myVars.autoNewGame = false;
    myVars.lastAutoNewGame = 0;
    myVars.detectedTimeControl = null;
    var myFunctions = document.myFunctions = {};
    function resolveCurrentFen(){
        if(board && board.game && typeof board.game.getFEN === 'function'){
            try{
                return board.game.getFEN();
            } catch (error){
                console.warn('Unable to read FEN from board', error);
            }
        }
        return null;
    }

    function getBoardElement(){
        return $('chess-board')[0] || $('wc-chess-board')[0];
    }


    myFunctions.color = function(dat){
        response = dat;
        var res1 = response.substring(0, 2);
        var res2 = response.substring(2, 4);

        if(myVars.autoMove == true){
            myFunctions.movePiece(res1, res2);
        }
        isThinking = false;

        res1 = res1.replace(/^a/, "1")
            .replace(/^b/, "2")
            .replace(/^c/, "3")
            .replace(/^d/, "4")
            .replace(/^e/, "5")
            .replace(/^f/, "6")
            .replace(/^g/, "7")
            .replace(/^h/, "8");
        res2 = res2.replace(/^a/, "1")
            .replace(/^b/, "2")
            .replace(/^c/, "3")
            .replace(/^d/, "4")
            .replace(/^e/, "5")
            .replace(/^f/, "6")
            .replace(/^g/, "7")
            .replace(/^h/, "8");
        $(board.nodeName)
            .prepend('<div class="highlight square-' + res2 + ' bro" style="background-color: rgb(235, 97, 80); opacity: 0.71;" data-test-element="highlight"></div>')
            .children(':first')
            .delay(1800)
            .queue(function() {
            $(this)
                .remove();
        });
        $(board.nodeName)
            .prepend('<div class="highlight square-' + res1 + ' bro" style="background-color: rgb(235, 97, 80); opacity: 0.71;" data-test-element="highlight"></div>')
            .children(':first')
            .delay(1800)
            .queue(function() {
            $(this)
                .remove();
        });
    }

    myFunctions.movePiece = function(from, to){
        if(!board || !board.game || typeof board.game.getLegalMoves !== 'function'){
            return;
        }
        for (var each=0;each<board.game.getLegalMoves().length;each++){
            if(board.game.getLegalMoves()[each].from == from){
                if(board.game.getLegalMoves()[each].to == to){
                    var move = board.game.getLegalMoves()[each];
                    board.game.move({
                        ...move,
                        promotion: 'false',
                        animate: false,
                        userGenerated: true
                    });
                }
            }
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
            console.log(moveToken);
            myFunctions.color(moveToken);
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

    var lastValue = 11;
    myFunctions.runChessEngine = function(depth){
        var fen = resolveCurrentFen();
        if(!fen){
            console.warn('No FEN available to send to Stockfish.');
            return;
        }
        engine.engine.postMessage(`position fen ${fen}`);
        console.log('updated: ' + `position fen ${fen}`);
        isThinking = true;
        engine.engine.postMessage(`go depth ${depth}`);
        lastValue = depth;
        const fenTokens = fen.split(/\s+/);
        searchContext.sideToMove = fenTokens[1] || 'w';
        updateEvaluationBarDisplay();
    }

    myFunctions.autoRun = function(lstValue){
        if(board && board.game && typeof board.game.getTurn === 'function' && typeof board.game.getPlayingAs === 'function' && board.game.getTurn() == board.game.getPlayingAs()){
            myFunctions.runChessEngine(lstValue);
        }
    }

    function handleDepthHotkeys(event){
        if(event.defaultPrevented){
            return;
        }
        const target = event.target;
        if(target){
            const tag = (target.tagName || '').toUpperCase();
            if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable){
                return;
            }
        }
        switch (event.keyCode) {
            case 81: myFunctions.runChessEngine(1); break;   // Q
            case 87: myFunctions.runChessEngine(2); break;   // W
            case 69: myFunctions.runChessEngine(3); break;   // E
            case 82: myFunctions.runChessEngine(4); break;   // R
            case 84: myFunctions.runChessEngine(5); break;   // T
            case 89: myFunctions.runChessEngine(6); break;   // Y
            case 85: myFunctions.runChessEngine(7); break;   // U
            case 73: myFunctions.runChessEngine(8); break;   // I
            case 79: myFunctions.runChessEngine(9); break;   // O
            case 80: myFunctions.runChessEngine(10); break;  // P
            case 65: myFunctions.runChessEngine(11); break;  // A
            case 83: myFunctions.runChessEngine(12); break;  // S
            case 68: myFunctions.runChessEngine(13); break;  // D
            case 70: myFunctions.runChessEngine(14); break;  // F
            case 71: myFunctions.runChessEngine(15); break;  // G
            case 72: myFunctions.runChessEngine(16); break;  // H
            case 74: myFunctions.runChessEngine(17); break;  // J
            case 75: myFunctions.runChessEngine(18); break;  // K
            case 76: myFunctions.runChessEngine(19); break;  // L
            case 90: myFunctions.runChessEngine(20); break;  // Z
            case 88: myFunctions.runChessEngine(21); break;  // X
            case 67: myFunctions.runChessEngine(22); break;  // C
            case 86: myFunctions.runChessEngine(23); break;  // V
            case 66: myFunctions.runChessEngine(24); break;  // B
            case 78: myFunctions.runChessEngine(25); break;  // N
            case 77: myFunctions.runChessEngine(26); break;  // M
            case 187: myFunctions.runChessEngine(100); break; // '=' / '+'
            default: return;
        }
        event.preventDefault();
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

    var adRemoved = false;
    myFunctions.removeAdSlot = function(){
        if(adRemoved){return;}
        try {
            var adContainer = $('#sky-atf')[0];
            if(adContainer && adContainer.children.length > 0){
                adContainer.innerHTML = '';
                adRemoved = true;
            }
        } catch (er) {console.log('Error removing ad slot: '+er);}
    }

    myFunctions.handleAutoNewGame = function(){
        if(!myVars.autoNewGame){return;}
        var now = Date.now();
        if(myVars.lastAutoNewGame && (now - myVars.lastAutoNewGame) < 5000){return;}
        var buttons = Array.from(document.querySelectorAll('button.game-over-buttons-button'));
        var targetButton = buttons.find(btn => {
            if(!btn || btn.disabled){return false;}
            var text = (btn.textContent || '').replace(/\s+/g,' ').trim().toLowerCase();
            if(!text){return false;}
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

    var loaded = false;
    myFunctions.loadEx = function(){
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
#sf-control-root .sf-toggle{width:56px;height:56px;border-radius:50%;border:none;background-color:#3cba2c;background-image:url('data:image/png;base64,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');background-size:cover;background-position:center;background-repeat:no-repeat;color:#fff;font-weight:600;font-size:18px;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,0.25);transition:transform 0.15s ease,box-shadow 0.15s ease;}
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
        } catch (error) {console.log(error)}
    }


    function other(delay){
        var endTime = Date.now() + delay;
        var timer = setInterval(()=>{
            if(Date.now() >= endTime){
                myFunctions.autoRun(lastValue);
                canGo = true;
                clearInterval(timer);
            }
        },10);
    }


    async function getVersion(){
        try{
            var GF = new GreasyFork; // set upping api
            var code = await GF.get().script().code(460208); // Get code
            var version = GF.parseScriptCodeMeta(code).filter(e => e.meta === '@version')[0].value; // filtering array and getting value of @version

            if(currentVersion !== version){
                console.warn(`Chess.com Bot/Cheat userscript update available. Current: ${currentVersion}, Latest: ${version}`);
            }
        } catch (error) {
            console.warn('Unable to check userscript version:', error);
        }
    }

    //Removed due to script being reported. I tried to make it so people can know when bug fixes come out. Clearly people don't like that.
    //getVersion();

    const waitForChessBoard = setInterval(() => {
        updateEvaluationBarDisplay();
        if(loaded) {
            board = getBoardElement();
            var autoRunCheckbox = $('#autoRun')[0];
            var autoMoveCheckbox = $('#autoMove')[0];
            var autoNewGameCheckbox = $('#autoNewGame')[0];
            var minDelayInput = $('#timeDelayMin')[0];
            var maxDelayInput = $('#timeDelayMax')[0];
            var depthText = $('#depthText')[0];

            if(autoRunCheckbox){ myVars.autoRun = autoRunCheckbox.checked; }
            if(autoMoveCheckbox){ myVars.autoMove = autoMoveCheckbox.checked; }
            if(autoNewGameCheckbox){ myVars.autoNewGame = autoNewGameCheckbox.checked; }

            var minBound = minDelayInput ? parseFloat(minDelayInput.value) : 0.3;
            var maxBound = maxDelayInput ? parseFloat(maxDelayInput.value) : minBound;

            if(!Number.isFinite(minBound) || minBound < 0.1){
                minBound = 0.3;
            }
            if(!Number.isFinite(maxBound) || maxBound < minBound){
                maxBound = minBound + 0.4;
            }

            if(board && board.game && typeof board.game.getPlayingAs === 'function'){
                myVars.playingAs = board.game.getPlayingAs();
            }

            const clocks = getClockSnapshot();
            const captureStats = getCapturedMaterialStats();
            const moveNumber = getMoveNumberEstimate();
            const phase = estimateGamePhase(moveNumber, captureStats);
            const playingAs = myVars.playingAs || clocks.bottom.color || 'white';

            let myTime = clocks.bottom.seconds;
            let oppTime = clocks.top.seconds;

            if(playingAs === clocks.top.color){
                myTime = clocks.top.seconds;
                oppTime = clocks.bottom.seconds;
            }

            const observedSeconds = Math.max(
                Number.isFinite(myTime) ? myTime : 0,
                Number.isFinite(oppTime) ? oppTime : 0
            );
            if(observedSeconds > 0){
                const observedMinutes = observedSeconds / 60;
                const previous = Number.isFinite(myVars.detectedTimeControl) ? myVars.detectedTimeControl : 0;
                myVars.detectedTimeControl = Math.max(previous, observedMinutes);
            }

            const timeControlMinutes = Number.isFinite(myVars.detectedTimeControl) && myVars.detectedTimeControl > 0
                ? myVars.detectedTimeControl
                : 3;

            myVars.delay = computeHumanDelay({
                myTime: Number.isFinite(myTime) ? myTime : null,
                oppTime: Number.isFinite(oppTime) ? oppTime : null,
                phase: phase,
                moveNumber: moveNumber,
                captureStats: captureStats,
                playingAs: playingAs,
                minBound: minBound,
                maxBound: maxBound,
                timeControlMinutes: timeControlMinutes,
                playerTempo: getTempoSeconds(true),
                opponentTempo: getTempoSeconds(false),
                engineVolatility: engineMetrics.volatility,
                engineSpeed: engineMetrics.nps,
                engineDepth: evaluationState.depth,
                evaluationType: evaluationState.type,
                evaluationValue: evaluationState.value
            });
            myVars.isThinking = isThinking;
            if(typeof myFunctions.spinner === 'function'){
                myFunctions.spinner();
            }
            if(board && board.game && typeof board.game.getTurn === 'function' && typeof board.game.getPlayingAs === 'function'){
                myTurn = board.game.getTurn() == board.game.getPlayingAs();
            } else if(playingAs === clocks.bottom.color){
                myTurn = clocks.bottom.isTurn;
            } else if(playingAs === clocks.top.color){
                myTurn = clocks.top.isTurn;
            } else {
                myTurn = clocks.bottom.isTurn;
            }
            updateTempoStats(Boolean(myTurn));
            if(depthText){
                depthText.innerHTML = "Your Current Depth Is: <strong>"+lastValue+"</strong>";
            }
        } else {
            myFunctions.loadEx();
        }

        if(!adRemoved){
            myFunctions.removeAdSlot();
        }

        myFunctions.handleAutoNewGame();

        if(!engine.engine){
            myFunctions.loadChessEngine();
        }
        if(myVars.autoRun == true && canGo == true && isThinking == false && myTurn){
            //console.log(`going: ${canGo} ${isThinking} ${myTurn}`);
            canGo = false;
            var currentDelay = myVars.delay != undefined ? myVars.delay * 1000 : 10;
            other(currentDelay);
        }
    }, 100);
}

//Touching below may break the script

var isThinking = false
var canGo = true;
var myTurn = false;
var board;

ROOT_WINDOW.addEventListener("load", () => {
    main();
});
