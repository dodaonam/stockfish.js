(async function () {
  const root = window.LichessCoach;
  await root.storage.load();
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'TOGGLE_EXTENSION') { root.state.enabled = !!message.enabled; root.engine.cancel(); root.scheduler.requestAnalysis(); root.storage.set({ enabled: root.state.enabled }); root.ui.render(); root.overlay.render(); } });
  root.scheduler.start();
})();
