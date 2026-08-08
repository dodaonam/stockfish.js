(function () {
  window.LichessCoach = window.LichessCoach || {};
  window.LichessCoach.config = {
    source: '__LSC_EXTENSION_BRIDGE__',
    multipv: 3,
    defaultDepth: 6,
    minDepth: 1,
    maxDepth: 11,
    delayMin: 0,
    delayMax: 0,
    pendingMoveTimeoutMs: 4000,
    overlayRefreshMs: 500,
    strictAiOnly: false,
    standardOnly: true,
    engineHashMb: 16,
    engineThreads: 1,
    stockfishBaseUrl: 'https://raw.githubusercontent.com/dodaonam/stockfish.js/main/stockfish_engine/171_single_nnue/',
    stockfishScript: 'stockfish-17.1-single-a496a04.js',
    // Virtual base name used by the Stockfish bootstrap to derive -part-N.wasm URLs.
    stockfishWasm: 'stockfish-17.1-single-a496a04.wasm',
    stockfishWasmPartCount: 6
  };
})();
