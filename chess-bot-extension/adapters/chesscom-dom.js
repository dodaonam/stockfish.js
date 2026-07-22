(function() {
    'use strict';

    const ChessBot = window.ChessBot;
    const { runtime } = ChessBot.state;

    const selectors = {
        board: ['chess-board', 'wc-chess-board'],
        evalHost: ['#board-layout-evaluation'],
        topClock: ['.clock-component.clock-top', '[data-testid="clock-top"]'],
        bottomClock: ['.clock-component.clock-bottom', '[data-testid="clock-bottom"]'],
        clockTime: ['.clock-time-monospace', '[data-testid="clock-time"]'],
        moveRows: [
            '.main-line-row.move-list-row[data-whole-move-number]',
            '.move-list-row[data-whole-move-number]'
        ],
        capturedPieces: ['.captured-pieces-cpiece', '[class*="captured-pieces-"]'],
        gameOverButtons: [
            'button.game-over-buttons-button',
            '[data-cy="game-over-modal"] button',
            '[data-testid="game-over-modal"] button'
        ],
        gameOverModal: [
            '.board-modal-component.game-over-modal-container',
            '.game-over-modal-container',
            '[data-cy="game-over-modal"]'
        ],
        gameOverNewGameButton: [
            'button[data-cy="game-over-modal-new-game-button"]',
            'button[data-testid="game-over-modal-new-game-button"]'
        ],
        controlPanelRoot: ['#sf-control-root']
    };
    const FILE_CHARS = 'abcdefgh';

    function queryFirst(selectorList, root = document) {
        for (const selector of selectorList) {
            const node = root.querySelector(selector);
            if (node) {
                return node;
            }
        }
        return null;
    }

    function queryAll(selectorList, root = document) {
        const matched = [];
        for (const selector of selectorList) {
            const nodes = Array.from(root.querySelectorAll(selector));
            if (nodes.length > 0) {
                matched.push(...nodes);
                break;
            }
        }
        return matched;
    }

    function parseClockText(text) {
        if (typeof text !== 'string') {
            return null;
        }
        const segments = text.trim().split(':').filter(Boolean);
        if (segments.length === 0) {
            return null;
        }
        let totalSeconds = 0;
        let multiplier = 1;
        for (let i = segments.length - 1; i >= 0; i--) {
            const segment = segments[i];
            const value = i === segments.length - 1 ? parseFloat(segment) : parseInt(segment, 10);
            if (!Number.isFinite(value)) {
                continue;
            }
            totalSeconds += value * multiplier;
            multiplier *= 60;
        }
        return totalSeconds || null;
    }

    function getBoardElement() {
        return queryFirst(selectors.board);
    }

    function resolveCurrentFen() {
        const board = runtime.board || getBoardElement();
        if (board && board.game && typeof board.game.getFEN === 'function') {
            try {
                return board.game.getFEN();
            } catch (error) {
                ChessBot.logger.warn('Unable to read FEN from board.game', error);
            }
        }

        try {
            const game = board?.game || window.game;
            if (game && typeof game.getFEN === 'function') {
                return game.getFEN();
            }
        } catch (error) {
            ChessBot.logger.debug('window.game FEN fallback failed', error);
        }

        try {
            const boardEl = getBoardElement();
            if (boardEl && boardEl.game && typeof boardEl.game.getFEN === 'function') {
                return boardEl.game.getFEN();
            }
        } catch (error) {
            ChessBot.logger.debug('DOM board FEN fallback failed', error);
        }

        return null;
    }

    function readClockComponent(component) {
        const defaultState = {
            seconds: null,
            isTurn: false,
            color: null
        };

        if (!component) {
            return defaultState;
        }

        const timeSpan = queryFirst(selectors.clockTime, component);
        return {
            seconds: parseClockText(timeSpan ? timeSpan.textContent : null),
            isTurn: component.classList.contains('clock-player-turn') || component.classList.contains('player-turn'),
            color: component.classList.contains('clock-white') ? 'white' :
                component.classList.contains('clock-black') ? 'black' : null
        };
    }

    function getClockSnapshot() {
        return {
            top: readClockComponent(queryFirst(selectors.topClock)),
            bottom: readClockComponent(queryFirst(selectors.bottomClock))
        };
    }

    function getMoveNumberEstimate() {
        const moveRows = queryAll(selectors.moveRows);
        if (!moveRows || moveRows.length === 0) {
            return 1;
        }
        const lastRow = moveRows[moveRows.length - 1];
        const moveAttribute = lastRow.getAttribute('data-whole-move-number');
        const parsed = parseInt(moveAttribute, 10);
        return Number.isFinite(parsed) ? parsed : 1;
    }

    function getCapturedMaterialStats() {
        const stats = {
            whiteCaptured: { pieces: 0, value: 0 },
            blackCaptured: { pieces: 0, value: 0 }
        };
        const valueMap = {
            pawn: 1, pawns: 1,
            knight: 3, knights: 3,
            bishop: 3, bishops: 3,
            rook: 5, rooks: 5,
            queen: 9, queens: 9
        };

        const spans = queryAll(selectors.capturedPieces);
        spans.forEach(span => {
            if (!span || span.classList.contains('captured-pieces-score')) {
                return;
            }
            const className = span.className || '';
            const match = className.match(/captured-pieces-(w|b)-(?:([0-9]+)-)?([a-z]+)/i);
            if (!match) {
                return;
            }

            const colorToken = match[1].toLowerCase();
            const count = match[2] ? parseInt(match[2], 10) : 1;
            const pieceToken = match[3] ? match[3].toLowerCase() : '';
            const pieceValue = valueMap[pieceToken];
            if (!Number.isFinite(count) || !Number.isFinite(pieceValue)) {
                return;
            }

            if (colorToken === 'w') {
                stats.whiteCaptured.pieces += count;
                stats.whiteCaptured.value += pieceValue * count;
            } else if (colorToken === 'b') {
                stats.blackCaptured.pieces += count;
                stats.blackCaptured.value += pieceValue * count;
            }
        });

        stats.totalPieces = stats.whiteCaptured.pieces + stats.blackCaptured.pieces;
        stats.totalValue = stats.whiteCaptured.value + stats.blackCaptured.value;
        return stats;
    }

    function getGameOverButtons() {
        return queryAll(selectors.gameOverButtons).filter(Boolean);
    }

    function getControlPanelRoot() {
        return queryFirst(selectors.controlPanelRoot);
    }

    function isElementVisible(node) {
        if (!node || !node.isConnected) {
            return false;
        }

        const style = window.getComputedStyle(node);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
            return false;
        }

        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isGameOverModalVisible() {
        const modal = queryFirst(selectors.gameOverModal);
        if (isElementVisible(modal)) {
            return true;
        }

        const newGameButton = queryFirst(selectors.gameOverNewGameButton);
        if (isElementVisible(newGameButton)) {
            return true;
        }

        const buttons = getGameOverButtons();
        for (const button of buttons) {
            if (!isElementVisible(button)) {
                continue;
            }
            const container = button.closest('.game-over-modal-container, .board-modal-component');
            if (!container || isElementVisible(container)) {
                return true;
            }
        }
        return false;
    }

    function isLiveGameContext() {
        const path = (window.location && window.location.pathname ? window.location.pathname : '').toLowerCase();
        if (!path) {
            return false;
        }
        if (path.includes('/puzzles') || path.includes('/analysis') || path.includes('/review')) {
            return false;
        }

        // Live/play surfaces on chess.com include both human games and computer games.
        if (path.startsWith('/play/') || path.startsWith('/game/')) {
            return true;
        }

        return false;
    }

    function iterateSquares(callback) {
        for (let rank = 1; rank <= 8; rank++) {
            for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
                callback(`${FILE_CHARS[fileIndex]}${rank}`);
            }
        }
    }

    function parseSquare(square) {
        if (typeof square !== 'string' || !/^[a-h][1-8]$/.test(square)) {
            return null;
        }
        return {
            file: square.charCodeAt(0) - 96,
            rank: parseInt(square.charAt(1), 10)
        };
    }

    function pieceType(piece) {
        return typeof piece === 'string' && piece.length > 0 ? piece.toLowerCase() : '';
    }

    function isSameColor(piece, sideToken) {
        if (typeof piece !== 'string' || piece.length === 0) {
            return false;
        }
        return sideToken === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
    }

    function parseFenBoard(fen) {
        if (typeof fen !== 'string' || fen.trim().length === 0) {
            return null;
        }

        const parts = fen.trim().split(/\s+/);
        if (parts.length < 4) {
            return null;
        }

        const placement = parts[0];
        const sideToMove = parts[1] === 'b' ? 'b' : 'w';
        const castling = parts[2] || '-';
        const enPassant = parts[3] && parts[3] !== '-' ? parts[3] : null;
        const board = {};
        const ranks = placement.split('/');

        if (ranks.length !== 8) {
            return null;
        }

        for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
            const row = ranks[rankIndex];
            let fileIndex = 0;
            const rank = 8 - rankIndex;

            for (let i = 0; i < row.length; i++) {
                const token = row.charAt(i);
                if (/\d/.test(token)) {
                    fileIndex += parseInt(token, 10);
                    continue;
                }
                if (!/[prnbqkPRNBQK]/.test(token) || fileIndex > 7) {
                    return null;
                }

                const square = `${FILE_CHARS[fileIndex]}${rank}`;
                board[square] = token;
                fileIndex += 1;
            }

            if (fileIndex !== 8) {
                return null;
            }
        }

        return {
            board,
            sideToMove,
            castling,
            enPassant
        };
    }

    function inferCastlingMove(previousState, nextState, sideToken) {
        if (!previousState || !nextState) {
            return null;
        }

        const prev = previousState.board;
        const next = nextState.board;

        if (sideToken === 'w') {
            if (prev.e1 === 'K' && prev.h1 === 'R' && next.g1 === 'K' && next.f1 === 'R') {
                return { uci: 'e1g1', toSquare: 'g1', sideMoved: 'white' };
            }
            if (prev.e1 === 'K' && prev.a1 === 'R' && next.c1 === 'K' && next.d1 === 'R') {
                return { uci: 'e1c1', toSquare: 'c1', sideMoved: 'white' };
            }
            return null;
        }

        if (prev.e8 === 'k' && prev.h8 === 'r' && next.g8 === 'k' && next.f8 === 'r') {
            return { uci: 'e8g8', toSquare: 'g8', sideMoved: 'black' };
        }
        if (prev.e8 === 'k' && prev.a8 === 'r' && next.c8 === 'k' && next.d8 === 'r') {
            return { uci: 'e8c8', toSquare: 'c8', sideMoved: 'black' };
        }
        return null;
    }

    function isPathClear(boardMap, fromCoords, toCoords, stepFile, stepRank) {
        let file = fromCoords.file + stepFile;
        let rank = fromCoords.rank + stepRank;

        while (file !== toCoords.file || rank !== toCoords.rank) {
            const square = `${FILE_CHARS[file - 1]}${rank}`;
            if (boardMap[square]) {
                return false;
            }
            file += stepFile;
            rank += stepRank;
        }

        return true;
    }

    function canPieceReach(previousState, fromSquare, toSquare, sideToken) {
        if (!previousState || !fromSquare || !toSquare || fromSquare === toSquare) {
            return false;
        }

        const boardMap = previousState.board;
        const piece = boardMap[fromSquare];
        if (!piece || !isSameColor(piece, sideToken)) {
            return false;
        }

        const fromCoords = parseSquare(fromSquare);
        const toCoords = parseSquare(toSquare);
        if (!fromCoords || !toCoords) {
            return false;
        }

        const destinationPiece = boardMap[toSquare] || null;
        if (destinationPiece && isSameColor(destinationPiece, sideToken)) {
            return false;
        }

        const fileDiff = toCoords.file - fromCoords.file;
        const rankDiff = toCoords.rank - fromCoords.rank;
        const absFileDiff = Math.abs(fileDiff);
        const absRankDiff = Math.abs(rankDiff);
        const type = pieceType(piece);

        if (type === 'n') {
            return (absFileDiff === 1 && absRankDiff === 2) || (absFileDiff === 2 && absRankDiff === 1);
        }

        if (type === 'k') {
            return absFileDiff <= 1 && absRankDiff <= 1;
        }

        if (type === 'b') {
            if (absFileDiff !== absRankDiff || absFileDiff === 0) {
                return false;
            }
            return isPathClear(boardMap, fromCoords, toCoords, Math.sign(fileDiff), Math.sign(rankDiff));
        }

        if (type === 'r') {
            if (fileDiff !== 0 && rankDiff !== 0) {
                return false;
            }
            const stepFile = fileDiff === 0 ? 0 : Math.sign(fileDiff);
            const stepRank = rankDiff === 0 ? 0 : Math.sign(rankDiff);
            return isPathClear(boardMap, fromCoords, toCoords, stepFile, stepRank);
        }

        if (type === 'q') {
            const isStraight = fileDiff === 0 || rankDiff === 0;
            const isDiagonal = absFileDiff === absRankDiff && absFileDiff > 0;
            if (!isStraight && !isDiagonal) {
                return false;
            }
            const stepFile = fileDiff === 0 ? 0 : Math.sign(fileDiff);
            const stepRank = rankDiff === 0 ? 0 : Math.sign(rankDiff);
            return isPathClear(boardMap, fromCoords, toCoords, stepFile, stepRank);
        }

        if (type !== 'p') {
            return false;
        }

        const direction = sideToken === 'w' ? 1 : -1;
        const startRank = sideToken === 'w' ? 2 : 7;
        const targetPiece = boardMap[toSquare] || null;

        if (fileDiff === 0) {
            if (rankDiff === direction && !targetPiece) {
                return true;
            }
            if (rankDiff === 2 * direction && fromCoords.rank === startRank && !targetPiece) {
                const intermediateSquare = `${FILE_CHARS[fromCoords.file - 1]}${fromCoords.rank + direction}`;
                return !boardMap[intermediateSquare];
            }
            return false;
        }

        if (absFileDiff !== 1 || rankDiff !== direction) {
            return false;
        }

        if (targetPiece && !isSameColor(targetPiece, sideToken)) {
            return true;
        }

        return !!(previousState.enPassant && previousState.enPassant === toSquare);
    }

    function inferPlayedMoveFromFenTransition(prevFen, nextFen) {
        const previousState = parseFenBoard(prevFen);
        const nextState = parseFenBoard(nextFen);
        if (!previousState || !nextState) {
            return null;
        }

        const sideToken = previousState.sideToMove === 'b' ? 'b' : 'w';
        const sideMoved = sideToken === 'w' ? 'white' : 'black';

        const castlingMove = inferCastlingMove(previousState, nextState, sideToken);
        if (castlingMove) {
            return castlingMove;
        }

        const changedSquares = [];
        iterateSquares(square => {
            const prevPiece = previousState.board[square] || null;
            const nextPiece = nextState.board[square] || null;
            if (prevPiece !== nextPiece) {
                changedSquares.push(square);
            }
        });

        if (changedSquares.length === 0) {
            return null;
        }

        const fromCandidates = [];
        const toCandidates = [];

        changedSquares.forEach(square => {
            const prevPiece = previousState.board[square] || null;
            const nextPiece = nextState.board[square] || null;

            if (prevPiece && isSameColor(prevPiece, sideToken) && (!nextPiece || !isSameColor(nextPiece, sideToken))) {
                fromCandidates.push(square);
            }
            if (nextPiece && isSameColor(nextPiece, sideToken) && (!prevPiece || !isSameColor(prevPiece, sideToken))) {
                toCandidates.push(square);
            }
        });

        if (fromCandidates.length === 0 || toCandidates.length === 0) {
            return null;
        }

        let fromSquare = null;
        let toSquare = null;

        if (fromCandidates.length === 1 && toCandidates.length === 1) {
            fromSquare = fromCandidates[0];
            toSquare = toCandidates[0];
        } else {
            const viablePairs = [];
            fromCandidates.forEach(from => {
                toCandidates.forEach(to => {
                    if (canPieceReach(previousState, from, to, sideToken)) {
                        viablePairs.push({ from, to });
                    }
                });
            });

            if (viablePairs.length !== 1) {
                return null;
            }

            fromSquare = viablePairs[0].from;
            toSquare = viablePairs[0].to;
        }

        const movedPiece = previousState.board[fromSquare];
        if (!movedPiece || !isSameColor(movedPiece, sideToken)) {
            return null;
        }

        let promotionSuffix = '';
        if (pieceType(movedPiece) === 'p') {
            const promotionRank = sideToken === 'w' ? '8' : '1';
            if (toSquare.charAt(1) === promotionRank) {
                const promotedPiece = nextState.board[toSquare] || null;
                const promotedType = pieceType(promotedPiece);
                if (promotedPiece && isSameColor(promotedPiece, sideToken) && /[qrbn]/.test(promotedType) && promotedType !== 'p') {
                    promotionSuffix = promotedType;
                }
            }
        }

        return {
            uci: `${fromSquare}${toSquare}${promotionSuffix}`,
            toSquare,
            sideMoved
        };
    }

    function getDomDetectionSnapshot() {
        return {
            board: !!getBoardElement(),
            evalHost: !!queryFirst(selectors.evalHost),
            topClock: !!queryFirst(selectors.topClock),
            bottomClock: !!queryFirst(selectors.bottomClock),
            moveList: queryAll(selectors.moveRows).length > 0,
            capturedPieces: queryAll(selectors.capturedPieces).length > 0,
            gameOverModal: getGameOverButtons().length > 0
        };
    }

    ChessBot.dom = {
        selectors,
        queryFirst,
        queryAll,
        getBoardElement,
        isLiveGameContext,
        resolveCurrentFen,
        getClockSnapshot,
        getMoveNumberEstimate,
        getCapturedMaterialStats,
        getGameOverButtons,
        isGameOverModalVisible,
        getControlPanelRoot,
        parseFenBoard,
        inferPlayedMoveFromFenTransition,
        getDomDetectionSnapshot
    };
})();
