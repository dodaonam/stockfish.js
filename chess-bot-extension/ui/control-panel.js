(function() {
    'use strict';

    const ChessBot = window.ChessBot;
    const { runtime, myVars } = ChessBot.state;
    const TOGGLE_ICON_DATA_URI = 'data:image/png;base64,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';

    const PANEL_STYLE = `
#sf-control-root{position:fixed;bottom:20px;right:20px;z-index:2147483646;font-family:'Segoe UI',Roboto,sans-serif;}
#sf-control-root .sf-toggle{width:56px;height:56px;border-radius:50%;border:none;background-color:#4a8f3a;background-image:url('${TOGGLE_ICON_DATA_URI}');background-size:cover;background-position:center;background-repeat:no-repeat;color:#fff;font-weight:700;font-size:16px;letter-spacing:0.5px;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,0.25);transition:transform 0.15s ease,box-shadow 0.15s ease;}
#sf-control-root .sf-toggle:hover{transform:translateY(-2px);box-shadow:0 12px 24px rgba(0,0,0,0.3);}
#sf-control-root.sf-open .sf-toggle{box-shadow:0 12px 28px rgba(0,0,0,0.35);}
#sf-control-root .sf-panel{position:absolute;bottom:70px;right:0;width:300px;max-width:calc(100vw - 40px);background:#fff;border-radius:14px;box-shadow:0 12px 28px rgba(0,0,0,0.28);padding:16px;opacity:0;pointer-events:none;transform:translateY(12px) scale(0.98);transition:opacity 0.2s ease,transform 0.2s ease;}
#sf-control-root.sf-open .sf-panel{opacity:1;pointer-events:auto;transform:translateY(0) scale(1);}
#sf-control-root .sf-panel-content{display:flex;flex-direction:column;gap:10px;}
#sf-control-root .sf-panel-header{margin-bottom:6px;}
#sf-control-root .sf-depth{margin:0;font-weight:600;}
#sf-control-root .sf-hint{margin:4px 0 0;font-size:12px;color:#555;}
#sf-control-root .sf-row{display:flex;align-items:center;gap:8px;margin:4px 0;}
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

    const PANEL_HTML = `
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
        <input type="number" id="timeDelayMin" name="timeDelayMin" min="0.1" value="0.6">
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
    <button type="button" id="relEngBut" class="sf-button">Reload Chess Engine</button>
</div>
`;

    function ensureControlPanelStyle() {
        if (document.getElementById('sf-control-style')) {
            return;
        }
        const styleEl = document.createElement('style');
        styleEl.id = 'sf-control-style';
        styleEl.textContent = PANEL_STYLE;
        document.head.appendChild(styleEl);
    }

    function getPanelInput(id) {
        return document.getElementById(id);
    }

    function loadControlPanel() {
        try {
            runtime.board = ChessBot.dom.getBoardElement();
            const anchorElement = runtime.board && runtime.board.parentElement
                ? (runtime.board.parentElement.parentElement || runtime.board.parentElement)
                : document.body;

            const existingRoot = ChessBot.dom.getControlPanelRoot();
            if (existingRoot) {
                existingRoot.remove();
            }

            ensureControlPanelStyle();

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
            panel.innerHTML = PANEL_HTML;

            root.appendChild(toggle);
            root.appendChild(panel);
            anchorElement.appendChild(root);

            toggle.addEventListener('click', () => {
                const isOpen = root.classList.toggle('sf-open');
                toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });

            const reloadButton = panel.querySelector('#relEngBut');
            if (reloadButton) {
                reloadButton.addEventListener('click', () => {
                    if (typeof ChessBot.engine.reloadChessEngine === 'function') {
                        ChessBot.engine.reloadChessEngine();
                    }
                });
            }

            runtime.loaded = true;
        } catch (error) {
            ChessBot.logger.error('Error loading extension UI:', error);
        }
    }

    function syncSettingsFromPanel() {
        const autoRunCheckbox = getPanelInput('autoRun');
        const evalOnlyCheckbox = getPanelInput('evalOnly');
        const autoMoveCheckbox = getPanelInput('autoMove');
        const autoNewGameCheckbox = getPanelInput('autoNewGame');

        if (autoRunCheckbox) {
            myVars.autoRun = autoRunCheckbox.checked;
        }
        if (evalOnlyCheckbox) {
            myVars.evalOnly = evalOnlyCheckbox.checked;
        }
        if (autoMoveCheckbox) {
            myVars.autoMove = autoMoveCheckbox.checked;
        }
        if (autoNewGameCheckbox) {
            myVars.autoNewGame = autoNewGameCheckbox.checked;
        }

        if (autoMoveCheckbox) {
            autoMoveCheckbox.disabled = !!myVars.evalOnly;
            if (myVars.evalOnly) {
                autoMoveCheckbox.checked = false;
                myVars.autoMove = false;
            }
        }
    }

    function setDepthLabel(depth) {
        const depthText = getPanelInput('depthText');
        if (depthText) {
            depthText.innerHTML = `Your Current Depth Is: <strong>${depth}</strong>`;
        }
    }

    function getDelayBounds() {
        const minDelayInput = parseFloat(getPanelInput('timeDelayMin')?.value);
        const maxDelayInput = parseFloat(getPanelInput('timeDelayMax')?.value);

        const minDelayVal = Number.isFinite(minDelayInput) ? Math.max(0.1, minDelayInput) : 0.6;
        const maxDelayVal = Number.isFinite(maxDelayInput) ? Math.max(minDelayVal, maxDelayInput) : Math.max(minDelayVal, 1);

        return {
            minDelayVal,
            maxDelayVal
        };
    }

    function updateSpinner() {
        const overlay = getPanelInput('overlay');
        if (overlay) {
            overlay.style.display = runtime.isThinking ? 'flex' : 'none';
        }

        const evalRoot = document.getElementById('sf-eval-root');
        if (evalRoot) {
            evalRoot.classList.toggle('sf-eval-thinking', runtime.isThinking === true);
        }
    }

    ChessBot.ui = ChessBot.ui || {};
    ChessBot.ui.controlPanel = {
        loadControlPanel,
        syncSettingsFromPanel,
        setDepthLabel,
        getDelayBounds,
        updateSpinner
    };
})();
