(function () {
  const root = window.LichessCoach;
  root.logger = {
    info: (...args) => console.info('[Lichess Coach]', ...args),
    warn: (...args) => console.warn('[Lichess Coach]', ...args),
    error: (...args) => console.error('[Lichess Coach]', ...args),
    debug: (...args) => console.debug('[Lichess Coach]', ...args)
  };
})();
