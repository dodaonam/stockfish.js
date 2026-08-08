(function () {
  const root = window.LichessCoach;
  root.state = {
    enabled: true,
    session: null,
    ui: { hints: true, depth: root.config.defaultDepth, delayMin: root.config.delayMin, delayMax: root.config.delayMax },
    engine: { status: 'idle', error: null, analysis: null }
  };
})();
