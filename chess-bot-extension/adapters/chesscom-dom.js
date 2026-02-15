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
        controlPanelRoot: ['#sf-control-root']
    };

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
        resolveCurrentFen,
        getClockSnapshot,
        getMoveNumberEstimate,
        getCapturedMaterialStats,
        getGameOverButtons,
        getControlPanelRoot,
        getDomDetectionSnapshot
    };
})();
