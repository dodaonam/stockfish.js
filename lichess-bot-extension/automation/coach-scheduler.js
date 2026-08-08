(function () {
  const root = window.LichessCoach;
  let analysisTimer = null;
  let bootstrapTimer = null;
  let generation = 0;
  let started = false;

  function clearAnalysisTimer() {
    clearTimeout(analysisTimer);
    analysisTimer = null;
  }

  function clearPending(session) {
    if (!session) return;
    clearTimeout(session.pendingTimer);
    session.pendingTimer = null;
    session.pendingMove = null;
    session.pendingSince = 0;
  }

  function schedulePendingTimeout(session) {
    clearTimeout(session.pendingTimer);
    session.pendingTimer = setTimeout(() => {
      if (!root.state.session || root.state.session !== session || !session.pendingMove) return;
      session.status = 'desynced';
      session.desyncReason = `No server confirmation for ${session.pendingMove}`;
      root.engine.cancel();
      root.ui.render();
      scheduleBootstrap(session.fullId, 'pending-timeout');
    }, root.config.pendingMoveTimeoutMs);
  }

  async function bootstrap(fullId, reason = 'event') {
    if (!fullId) return;
    const token = ++generation;
    clearAnalysisTimer();
    root.engine.cancel();
    try {
      const session = await root.session.bootstrap(fullId);
      if (token !== generation) return;
      root.state.session = session;
      root.state.engine.error = null;
      root.ui.render();
      root.overlay.render();
      requestAnalysis();
    } catch (error) {
      if (token !== generation) return;
      root.logger.warn('Bootstrap failed', reason, error);
      if (root.state.session?.fullId === fullId) {
        root.state.session.status = 'desynced';
        root.state.session.desyncReason = error.message || String(error);
      }
      root.state.engine.error = error.message || String(error);
      root.ui.render();
    }
  }

  function scheduleBootstrap(fullId, reason) {
    clearTimeout(bootstrapTimer);
    bootstrapTimer = setTimeout(() => bootstrap(fullId, reason), 250);
  }

  function requestAnalysis() {
    clearAnalysisTimer();
    const session = root.state.session;
    if (!root.state.enabled || !root.state.ui.hints || !session || session.status !== 'active' || !session.guard.canCoach || !root.session.isMyTurn(session)) return;

    const min = Math.min(root.state.ui.delayMin, root.state.ui.delayMax);
    const max = Math.max(root.state.ui.delayMin, root.state.ui.delayMax);
    const requestedFen = session.engineFen;
    analysisTimer = setTimeout(() => {
      analysisTimer = null;
      if (!root.state.enabled || !root.state.ui.hints || root.state.session !== session || session.engineFen !== requestedFen || !root.session.isMyTurn(session) || !session.guard.canCoach) return;
      root.engine.search({ fen: requestedFen, gameId: session.gameId });
    }, (min + Math.random() * (max - min)) * 1000);
  }

  function handleInbound(meta, message) {
    if (!meta || meta.kind !== 'play' || !message) return;
    const session = root.state.session;
    if (!session || session.fullId !== meta.fullId) {
      scheduleBootstrap(meta.fullId, 'inbound-before-bootstrap');
      return;
    }

    if (message.t === 'reload') {
      scheduleBootstrap(meta.fullId, 'reload-event');
      return;
    }
    if (message.t === 'endData') {
      clearPending(session);
      root.engine.cancel();
      root.ui.render();
      return;
    }
    if (message.t !== 'move' && message.t !== 'drop') return;

    clearAnalysisTimer();
    root.engine.cancel();
    if (!root.session.updateFromMove(session, message.d)) {
      session.status = 'desynced';
      session.desyncReason = 'Incomplete move data';
      root.ui.render();
      scheduleBootstrap(meta.fullId, 'incomplete-move-data');
      return;
    }
    clearPending(session);
    requestAnalysis();
    root.ui.render();
    root.overlay.render();
  }

  function handleOutbound(meta, message) {
    if (!meta || meta.kind !== 'play' || !message) return;
    let session = root.state.session;
    if (!session || session.fullId !== meta.fullId) {
      scheduleBootstrap(meta.fullId, 'outbound-before-bootstrap');
      return;
    }
    if (message.t !== 'move' && message.t !== 'drop') return;

    clearAnalysisTimer();
    root.engine.cancel();
    session.pendingMove = message.t === 'move'
      ? (typeof message.d?.u === 'string' ? message.d.u : 'move')
      : (typeof message.d?.pos === 'string' && typeof message.d?.role === 'string' ? `${message.d.role}@${message.d.pos}` : 'drop');
    session.pendingSince = Date.now();
    session.status = 'active';
    schedulePendingTimeout(session);
    root.ui.render();
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') || target.getAttribute('role') === 'textbox';
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function handleShortcut(event) {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
    const key = String(event.key || '').toLowerCase();
    if (!['s', 'z', 'h'].includes(key)) return;
    consume(event);
    if (key === 's') root.ui.toggleHints();
    if (key === 'z') root.ui.togglePanel();
    if (key === 'h') root.ui.toggleHidden();
  }

  root.scheduler = {
    requestAnalysis,
    start() {
      if (started) return;
      started = true;
      root.bridge.onMessage((type, payload) => {
        if (type === 'ROUND_SOCKET_OPEN' && payload?.kind === 'play') {
          if (root.state.session?.fullId !== payload.fullId) scheduleBootstrap(payload.fullId, 'socket-open');
          return;
        }
        if (type === 'ROUND_SOCKET_IN') {
          handleInbound(payload?.meta, payload?.msg);
          return;
        }
        if (type === 'ROUND_SOCKET_OUT') handleOutbound(payload?.meta, payload?.msg);
      });
      window.addEventListener('keydown', handleShortcut, true);
      window.addEventListener('keyup', event => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey && ['s', 'z', 'h'].includes(String(event.key || '').toLowerCase()) && !isEditableTarget(event.target)) consume(event);
      }, true);
      setInterval(() => root.overlay.render(), root.config.overlayRefreshMs);
      window.addEventListener('resize', () => root.overlay.render(), { passive: true });
      window.addEventListener('scroll', () => root.overlay.render(), { passive: true });
      window.addEventListener('beforeunload', () => root.engine.destroy(), { once: true });
      root.ui.render();
    }
  };
})();
