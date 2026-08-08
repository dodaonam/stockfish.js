(function () {
  const root = window.LichessCoach;
  root.ui = {
    render() {
      let host = document.getElementById('lsc-panel-host');
      if (!host) { host = document.createElement('div'); host.id = 'lsc-panel-host'; document.body?.appendChild(host); host.attachShadow({ mode: 'open' }); }
      host.style.cssText = `position:fixed;right:20px;bottom:20px;width:56px;height:56px;z-index:2147483647;pointer-events:none;display:${host.uiHidden ? 'none' : 'block'};`;
      const ui = root.state.ui; const shadow = host.shadowRoot;
      shadow.innerHTML = `<style>
        :host{all:initial;font:14px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial;color:#222}
        button{position:absolute;right:0;bottom:0;border:0;border-radius:50%;width:56px;height:56px;background:#4a8f3a;color:#fff;font-size:30px;line-height:1;cursor:pointer;box-shadow:0 8px 20px #0004;pointer-events:auto}
        .box{position:absolute;right:0;bottom:72px;background:#fff;border-radius:14px;padding:16px;width:300px;max-width:calc(100vw - 40px);box-shadow:0 12px 28px #0004;box-sizing:border-box;pointer-events:auto}
        .row{margin:12px 0}.row:last-of-type{margin-bottom:8px}label{display:block;margin-bottom:5px;line-height:1.35}input,select{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font:inherit;color:#222;background:#fff}input[type=checkbox]{width:auto;margin-right:6px;padding:0;vertical-align:middle}small{color:#666}.hidden{display:none}
      </style><button id="toggle" aria-label="Toggle Stockfish controls">♟</button><div id="box" class="box ${host.open ? '' : 'hidden'}"><strong>Lichess Stockfish Coach</strong><div class="row"><small>${root.state.engine.status}${root.state.engine.error ? `: ${root.state.engine.error}` : ''}</small></div><div class="row"><small>${root.state.session?.guard?.reason || 'Waiting game'}${root.state.session?.desyncReason ? ` — ${root.state.session.desyncReason}` : ''}</small></div><div class="row"><label><input id="hints" type="checkbox" ${ui.hints ? 'checked' : ''}> Show move hints</label></div><div class="row"><label>Analysis depth</label><select id="depth">${Array.from({length: root.config.maxDepth}, (_, i) => `<option ${ui.depth === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div><div class="row"><label>Delay minimum (s)</label><input id="min" type="number" min="0" step="0.1" value="${ui.delayMin}"></div><div class="row"><label>Delay maximum (s)</label><input id="max" type="number" min="0" step="0.1" value="${ui.delayMax}"></div></div>`;
      shadow.getElementById('toggle').onclick = () => root.ui.togglePanel();
      shadow.getElementById('hints').onchange = event => { ui.hints = event.target.checked; root.storage.set({ hints: ui.hints }); if (!ui.hints) root.engine.cancel(); else root.scheduler.requestAnalysis(); root.ui.render(); root.overlay.render(); };
      shadow.getElementById('depth').onchange = event => { ui.depth = Number(event.target.value); root.storage.set({ analysisDepth: ui.depth }); root.scheduler.requestAnalysis(); };
      for (const id of ['min', 'max']) shadow.getElementById(id).onchange = () => { ui.delayMin = Math.max(0, Number(shadow.getElementById('min').value) || 0); ui.delayMax = Math.max(ui.delayMin, Number(shadow.getElementById('max').value) || ui.delayMin); root.storage.set({ delayMin: ui.delayMin, delayMax: ui.delayMax }); root.scheduler.requestAnalysis(); };
    },
    togglePanel() {
      const host = document.getElementById('lsc-panel-host');
      if (!host) return;
      host.open = !host.open;
      this.render();
    },
    toggleHints() {
      const ui = root.state.ui;
      ui.hints = !ui.hints;
      root.storage.set({ hints: ui.hints });
      if (!ui.hints) root.engine.cancel(); else root.scheduler.requestAnalysis();
      this.render();
      root.overlay.render();
    },
    toggleHidden() {
      const host = document.getElementById('lsc-panel-host');
      if (!host) return;
      host.uiHidden = !host.uiHidden;
      this.render();
    }
  };
})();
