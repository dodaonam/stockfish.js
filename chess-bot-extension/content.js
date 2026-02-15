(function() {
    'use strict';

    let started = false;
    let pendingToggleState = null;

    window.addEventListener('chess-bot-toggle', event => {
        pendingToggleState = event && event.detail ? event.detail.enabled : null;
        if (typeof window.setChessBotEnabled === 'function') {
            window.setChessBotEnabled(pendingToggleState);
        }
    });

    function start() {
        if (started) {
            return;
        }

        if (!window.ChessBot || !window.ChessBot.scheduler) {
            setTimeout(start, 50);
            return;
        }

        started = true;
        window.ChessBot.scheduler.start();
        if (pendingToggleState !== null && typeof window.setChessBotEnabled === 'function') {
            window.setChessBotEnabled(pendingToggleState);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
