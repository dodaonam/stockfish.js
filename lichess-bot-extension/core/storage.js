(function () {
  const root = window.LichessCoach;
  const keys = ['analysisDepth', 'delayMin', 'delayMax', 'hints', 'enabled'];
  root.storage = {
    async load() {
      const data = await chrome.storage.local.get(keys);
      const ui = root.state.ui;
      if (data.analysisDepth != null) ui.depth = Math.max(root.config.minDepth, Math.min(root.config.maxDepth, Number(data.analysisDepth) || root.config.defaultDepth));
      ui.delayMin = 0;
      ui.delayMax = 0;
      await chrome.storage.local.set({ delayMin: 0, delayMax: 0 });
      if (typeof data.hints === 'boolean') ui.hints = data.hints;
      if (typeof data.enabled === 'boolean') root.state.enabled = data.enabled;
    },
    set(values) { return chrome.storage.local.set(values); }
  };
})();
