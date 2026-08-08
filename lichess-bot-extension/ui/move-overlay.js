(function () {
  const root = window.LichessCoach;
  function boardInfo() {
    const board = document.querySelector('.round__app__board cg-board, .main-board cg-board, cg-board');
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    if (!rect.width) return null;
    return { rect, black: board.closest('.cg-wrap')?.classList.contains('orientation-black') };
  }
  function center(square, info) {
    if (!/^[a-h][1-8]$/.test(square)) return null;
    const file = square.charCodeAt(0) - 97; const rank = Number(square[1]); const size = info.rect.width / 8;
    const x = info.black ? 7 - file : file; const y = info.black ? rank - 1 : 8 - rank;
    return { x: info.rect.left + (x + .5) * size, y: info.rect.top + (y + .5) * size, size };
  }
  function ensure() {
    let host = document.getElementById('lsc-overlay-host');
    if (host) return host;
    host = document.createElement('div'); host.id = 'lsc-overlay-host'; host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;'; document.body?.appendChild(host);
    host.attachShadow({ mode: 'open' }).innerHTML = '<svg width="100%" height="100%" style="overflow:visible"><defs><marker id="lsc-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto"><path d="M 1.7 2.2 L 8.5 5 L 1.7 7.8 z" fill="#50c878"></path></marker></defs><g id="lsc-arrows"></g></svg>';
    return host;
  }
  root.overlay = {
    render() {
      const host = ensure(); const layer = host?.shadowRoot?.getElementById('lsc-arrows'); if (!layer) return;
      layer.innerHTML = ''; const session = root.state.session; const analysis = root.state.engine.analysis;
      if (!root.state.enabled || !root.state.ui.hints || !root.session.isMyTurn(session) || analysis?.fen !== session?.engineFen) return;
      const info = boardInfo(); if (!info) return;
      const colors = ['#50c878', '#50c878', '#50c878'];
      for (const [index, line] of (analysis.lines || []).slice(0, 3).entries()) {
        if (session.legalDests?.size && !root.session.isLegalMove(line.move, session.legalDests)) continue;
        const from = center(line.move?.slice(0, 2), info); const to = center(line.move?.slice(2, 4), info); if (!from || !to) continue;
        layer.insertAdjacentHTML('beforeend', `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${colors[index]}" stroke-opacity="${.9 - index * .3}" stroke-width="${Math.max(3, from.size * (.18 - index * .04))}" stroke-linecap="round" marker-end="url(#lsc-arrow)"></line>`);
      }
    }
  };
})();
