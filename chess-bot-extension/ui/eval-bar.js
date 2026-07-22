(function() {
    'use strict';

    const ChessBot = window.ChessBot;
    const {
        runtime,
        evaluationState,
        searchContext,
        myVars
    } = ChessBot.state;

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

    function ensureEvaluationBarRoot() {
        const host = ChessBot.dom.queryFirst(ChessBot.dom.selectors.evalHost);
        if (!host) {
            return null;
        }

        ensureEvaluationBarStyle();
        let root = document.getElementById('sf-eval-root');
        if (!root || !host.contains(root)) {
            if (!root) {
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
</div>`;
            }
            host.appendChild(root);
        }
        return root;
    }

    function computeWhiteCentipawns() {
        if (!evaluationState.type || !Number.isFinite(evaluationState.value)) {
            return null;
        }

        const multiplier = searchContext.sideToMove === 'w' ? 1 : -1;
        if (evaluationState.type === 'mate') {
            let mateValue = evaluationState.value;
            if (mateValue === 0) {
                mateValue = -1;
            }
            const sign = mateValue * multiplier;
            return sign > 0 ? 1000 : -1000;
        }
        return evaluationState.value * multiplier;
    }

    function centipawnsToWinFraction(cp) {
        if (cp === null || !Number.isFinite(cp)) {
            return 0.5;
        }
        if (evaluationState.type === 'mate') {
            return cp > 0 ? 1 : 0;
        }
        const clamped = ChessBot.timing.clamp(cp, -10000, 10000);
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
            return `M${Math.abs(mateForWhite)}`;
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
        if (cpForPlayer > 10) {
            return 'me';
        }
        if (cpForPlayer < -10) {
            return 'opponent';
        }
        return 'equal';
    }

    function shouldShowEvaluationBar() {
        if (!runtime.extensionEnabled) {
            return false;
        }
        return !!(myVars.autoRun || myVars.evalOnly);
    }

    function updateEvaluationBarDisplay() {
        const root = ensureEvaluationBarRoot();
        if (!root) {
            return;
        }

        const shouldShow = shouldShowEvaluationBar();
        root.style.display = shouldShow ? '' : 'none';
        if (!shouldShow) {
            return;
        }

        const isDark = !!(document.body && document.body.classList && document.body.classList.contains('theme-dark'));
        root.classList.toggle('sf-eval-dark', isDark);
        root.classList.toggle('sf-eval-thinking', runtime.isThinking === true);

        const playerColor = runtime.confirmedPlayerColor || ChessBot.timing.getPlayerColor();
        root.classList.toggle('sf-player-black', playerColor === 'black');

        const scoreEl = root.querySelector('.sf-eval-score');
        const scoreContainer = root.querySelector('.sf-eval-score-container');
        const whiteFill = root.querySelector('.sf-eval-white');
        const blackFill = root.querySelector('.sf-eval-black');
        const pointer = root.querySelector('.sf-eval-pointer');

        if (!runtime.isInActiveGame || !evaluationState.type) {
            if (scoreEl) {
                scoreEl.textContent = '';
                scoreEl.classList.remove('sf-score-light', 'sf-score-dark');
            }
            if (scoreContainer) {
                scoreContainer.classList.remove('sf-score-top', 'sf-score-bottom');
            }
            if (whiteFill) {
                whiteFill.style.height = '50%';
            }
            if (blackFill) {
                blackFill.style.height = '50%';
            }
            if (pointer) {
                pointer.style.top = '50%';
            }
            return;
        }

        const cpWhite = computeWhiteCentipawns();
        const fraction = centipawnsToWinFraction(cpWhite);
        const whitePercent = ChessBot.timing.clamp(Math.round(fraction * 1000) / 10, 0, 100);
        const blackPercent = ChessBot.timing.clamp(100 - whitePercent, 0, 100);

        if (scoreEl) {
            scoreEl.textContent = formatEvaluationScoreText();
            scoreEl.title = '';
        }

        if (scoreContainer && scoreEl) {
            const advantage = getAdvantage(playerColor);
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

        if (whiteFill) {
            whiteFill.style.height = `${whitePercent}%`;
        }
        if (blackFill) {
            blackFill.style.height = `${blackPercent}%`;
        }

        if (pointer) {
            pointer.style.top = playerColor === 'black' ? `${whitePercent}%` : `${blackPercent}%`;
        }
    }

    function resetEvaluationState() {
        evaluationState.type = null;
        evaluationState.value = null;
        evaluationState.depth = null;
        runtime.isInActiveGame = false;
        runtime.confirmedPlayerColor = null;
        updateEvaluationBarDisplay();
    }

    ChessBot.evalBar = {
        shouldShowEvaluationBar,
        updateEvaluationBarDisplay,
        resetEvaluationState
    };
})();
