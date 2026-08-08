(function () {
  const root = window.LichessCoach;
  const source = root.config.source;
  root.bridge = {
    onMessage(handler) {
      window.addEventListener('message', event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.source !== source) return;
        handler(event.data.type, event.data.payload);
      });
      window.dispatchEvent(new CustomEvent('lsc-extension-content-ready'));
    }
  };
})();
