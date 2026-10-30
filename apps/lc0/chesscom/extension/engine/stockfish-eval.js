(function() {
  "use strict";

  const ChessBot = window.ChessBot;
  const { config, runtime, evaluationState } = ChessBot.state;

  let worker = null;
  let workerUrlPromise = null;
  let activeSearch = null;
  let searchSeq = 0;
  let readyPromise = null;
  let renderTimer = null;
  let renderQueued = false;
  const STARTUP_TIMEOUT_MS = 120_000;

  function patchBootstrapSource(source, wasmUrl) {
    const pattern = 'a=decodeURIComponent(e[0]||location.origin+location.pathname.replace(/\\.js$/i,".wasm"))';
    if (source.includes(pattern)) {
      return source.replace(pattern, `a='${wasmUrl}'`);
    }
    const fallback = /a=decodeURIComponent\(e\[0\]\|\|location\.origin\+location\.pathname\.replace\(\/\\\\\.js\$\/i,"\.wasm"\)\)/;
    if (fallback.test(source)) {
      return source.replace(fallback, `a='${wasmUrl}'`);
    }
    throw new Error("Unexpected Stockfish bootstrap format");
  }

  function getWasmPartUrls(wasmUrl) {
    const extensionIndex = wasmUrl.lastIndexOf(".wasm");
    if (extensionIndex < 0) {
      throw new Error("Invalid Stockfish WASM URL");
    }
    const baseUrl = wasmUrl.slice(0, extensionIndex);
    const suffix = wasmUrl.slice(extensionIndex);
    return Array.from({ length: 6 }, (_, index) => `${baseUrl}-part-${index}${suffix}`);
  }

  function addFetchAliases(map, url, blobUrl) {
    map[url] = blobUrl;
    try {
      const parsed = new URL(url);
      map[parsed.href] = blobUrl;
      map[parsed.pathname] = blobUrl;
      map[parsed.pathname.split("/").pop()] = blobUrl;
    } catch (_) {
      map[url.split("/").pop()] = blobUrl;
    }
  }

  function getFallbackWasmUrl(url) {
    return url.replace(
      "https://cdn.jsdelivr.net/gh/dodaonam/stockfish.js@main/",
      "https://raw.githubusercontent.com/dodaonam/stockfish.js/main/"
    );
  }

  async function fetchWasmPart(url) {
    const urls = [url, getFallbackWasmUrl(url)].filter((candidate, index, list) => list.indexOf(candidate) === index);
    let lastError = null;
    for (const candidate of urls) {
      try {
        const response = await fetch(candidate);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return { url: candidate, buffer: await response.arrayBuffer() };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Unable to download Stockfish WASM part: ${url} (${lastError?.message || "unknown error"})`);
  }

  async function buildWorkerUrl(scriptUrl, wasmUrl) {
    const response = await fetch(scriptUrl);
    if (!response.ok) {
      throw new Error(`Unable to download Stockfish script (${response.status})`);
    }
    const source = await response.text();
    const wasmUrls = getWasmPartUrls(wasmUrl);
    const wasmResults = await Promise.all(wasmUrls.map(url => fetchWasmPart(url)));
    const firstHeader = new Uint8Array(wasmResults[0].buffer.slice(0, 4));
    if (firstHeader.length !== 4 || firstHeader[0] !== 0x00 || firstHeader[1] !== 0x61 || firstHeader[2] !== 0x73 || firstHeader[3] !== 0x6d) {
      throw new Error("Stockfish WASM part 0 has an invalid WebAssembly header");
    }
    const wasmBlobUrls = wasmResults.map(result => URL.createObjectURL(
      new Blob([result.buffer], { type: "application/wasm" })
    ));
    const redirects = {};
    wasmResults.forEach((result, index) => {
      addFetchAliases(redirects, wasmUrls[index], wasmBlobUrls[index]);
      addFetchAliases(redirects, result.url, wasmBlobUrls[index]);
    });
    const patched = patchBootstrapSource(source, wasmUrl);
    const prelude = `
const __LC0_STOCKFISH_WASM_REDIRECTS__ = ${JSON.stringify(redirects)};
const __LC0_STOCKFISH_NATIVE_FETCH__ = self.fetch.bind(self);
const __LC0_STOCKFISH_FETCH_KEYS__ = function(input) {
  const raw = typeof input === "string" ? input : (input && input.url ? String(input.url) : "");
  const keys = raw ? [raw] : [];
  try {
    const parsed = new URL(raw, self.location.href);
    keys.push(parsed.href, parsed.pathname, parsed.pathname.split("/").pop());
  } catch (_) {
    if (raw) keys.push(raw.split("/").pop());
  }
  return [...new Set(keys.filter(Boolean))];
};
self.fetch = function(input, init) {
  for (const key of __LC0_STOCKFISH_FETCH_KEYS__(input)) {
    const mappedUrl = __LC0_STOCKFISH_WASM_REDIRECTS__[key];
    if (mappedUrl) return __LC0_STOCKFISH_NATIVE_FETCH__(mappedUrl, init);
  }
  return __LC0_STOCKFISH_NATIVE_FETCH__(input, init);
};
self.Module = self.Module || {};
self.Module.locateFile = self.Module.locateFile || function(path) {
  return path && path.endsWith('.wasm') ? '${wasmUrl}' : path;
};
`;
    return URL.createObjectURL(new Blob([prelude, patched], { type: "application/javascript" }));
  }

  function ensureWorkerUrl() {
    if (workerUrlPromise) {
      return workerUrlPromise;
    }
    workerUrlPromise = (async () => {
      let lastError = null;
      for (let index = 0; index < config.STOCKFISH_SCRIPT_SOURCES.length; index += 1) {
        try {
          const url = await buildWorkerUrl(
            config.STOCKFISH_SCRIPT_SOURCES[index],
            config.STOCKFISH_WASM_SOURCES[index] || config.STOCKFISH_WASM_SOURCES[0]
          );
          return url;
        } catch (error) {
          lastError = error;
          ChessBot.logger.warn("Stockfish eval source failed", error);
        }
      }
      workerUrlPromise = null;
      throw lastError || new Error("Unable to load Stockfish eval engine");
    })();
    return workerUrlPromise;
  }

  function requestRender(immediate = false) {
    renderQueued = true;
    if (immediate) {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      renderQueued = false;
      ChessBot.evalBar?.updateEvaluationBarDisplay();
      return;
    }
    if (renderTimer) {
      return;
    }
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!renderQueued) {
        return;
      }
      renderQueued = false;
      ChessBot.evalBar?.updateEvaluationBarDisplay();
    }, config.STOCKFISH_EVAL_RENDER_INTERVAL_MS);
  }

  function clearEvaluationState() {
    evaluationState.fen = null;
    evaluationState.sideToMove = null;
    evaluationState.type = null;
    evaluationState.value = null;
    evaluationState.depth = null;
    evaluationState.updatedAt = 0;
    requestRender(true);
  }

  function parseInfo(message, snapshot) {
    if (typeof message !== "string" || !message.startsWith("info ")) {
      return;
    }
    const multiPv = message.match(/\bmultipv\s+(\d+)/i);
    if (multiPv && Number(multiPv[1]) !== 1) {
      return;
    }
    const depthMatch = message.match(/\bdepth\s+(\d+)/i);
    const depth = depthMatch ? Number(depthMatch[1]) : snapshot.depth;
    const mateMatch = message.match(/\bscore\s+mate\s+(-?\d+)/i);
    const cpMatch = message.match(/\bscore\s+cp\s+(-?\d+)/i);
    let type = null;
    let value = null;
    if (mateMatch) {
      type = "mate";
      value = Number(mateMatch[1]);
    } else if (cpMatch) {
      type = "cp";
      value = Number(cpMatch[1]);
    }
    if (!type || !Number.isFinite(value)) {
      return;
    }
    if (snapshot.type === null || depth >= snapshot.depth) {
      snapshot.type = type;
      snapshot.value = value;
      snapshot.depth = Number.isFinite(depth) ? depth : snapshot.depth;
      evaluationState.fen = snapshot.fen;
      evaluationState.sideToMove = snapshot.sideToMove;
      evaluationState.type = type;
      evaluationState.value = value;
      evaluationState.depth = snapshot.depth;
      evaluationState.updatedAt = Date.now();
      requestRender(false);
    }
  }

  function handleWorkerMessage(event) {
    const message = typeof event.data === "string" ? event.data : "";
    const search = activeSearch;
    if (!search) {
      return;
    }
    if (message.startsWith("info ")) {
      parseInfo(message, search.snapshot);
      return;
    }
    if (!message.toLowerCase().startsWith("bestmove ")) {
      return;
    }
    activeSearch = null;
    clearTimeout(search.timeoutId);
    requestRender(true);
    search.resolve({
      type: search.snapshot.type,
      value: search.snapshot.value,
      depth: search.snapshot.depth
    });
  }

  function handleWorkerError(event) {
    const message = event?.message || "Stockfish eval worker failed";
    if (activeSearch) {
      const search = activeSearch;
      activeSearch = null;
      clearTimeout(search.timeoutId);
      search.reject(new Error(message));
    }
    worker = null;
    readyPromise = null;
    clearEvaluationState();
  }

  async function ensureReady() {
    if (worker && readyPromise) {
      return readyPromise;
    }
    const url = await ensureWorkerUrl();
    worker = new Worker(url);
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
    readyPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error("Timed out waiting for Stockfish eval engine to become ready"));
      }, STARTUP_TIMEOUT_MS);
      const previousHandler = worker.onmessage;
      worker.onmessage = event => {
        const message = typeof event.data === "string" ? event.data : "";
        if (message.trim().toLowerCase() === "uciok") {
          settled = true;
          clearTimeout(timeoutId);
          worker.onmessage = previousHandler;
          worker.onerror = handleWorkerError;
          resolve();
          return;
        }
        previousHandler(event);
      };
      worker.onerror = event => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(new Error(event?.message || "Stockfish eval worker failed during startup"));
        }
        handleWorkerError(event);
      };
      worker.postMessage("uci");
    }).catch(error => {
      if (worker) {
        worker.terminate();
      }
      worker = null;
      readyPromise = null;
      throw error;
    });
    await readyPromise;
    worker.postMessage("setoption name Threads value 1");
    worker.postMessage("setoption name MultiPV value 1");
    worker.postMessage("ucinewgame");
    return readyPromise;
  }

  function stop() {
    if (worker) {
      try {
        worker.postMessage("stop");
      } catch (error) {
        ChessBot.logger.debug("Unable to stop Stockfish eval", error);
      }
    }
    if (activeSearch) {
      const search = activeSearch;
      activeSearch = null;
      clearTimeout(search.timeoutId);
      search.resolve(null);
    }
  }

  async function analyzeFen(fen) {
    if (typeof fen !== "string" || !fen.trim()) {
      return null;
    }
    const requestId = ++searchSeq;
    stop();
    await ensureReady();
    if (requestId !== searchSeq) {
      return null;
    }
    const normalizedFen = fen.trim();
    const sideToMove = (normalizedFen.split(/\s+/)[1] || "w").toLowerCase();
    const depth = config.STOCKFISH_EVAL_DEPTH;
    const result = await new Promise((resolve, reject) => {
      const snapshot = { fen: normalizedFen, sideToMove, type: null, value: null, depth: -1 };
      const timeoutId = setTimeout(() => {
        if (!activeSearch || activeSearch.id !== requestId) {
          return;
        }
        stop();
        reject(new Error("Stockfish eval search timed out"));
      }, 30_000);
      activeSearch = { id: requestId, snapshot, timeoutId, resolve, reject };
      try {
        worker.postMessage("stop");
        worker.postMessage(`position fen ${normalizedFen}`);
        worker.postMessage(`go depth ${depth}`);
      } catch (error) {
        clearTimeout(timeoutId);
        activeSearch = null;
        reject(error);
      }
    });
    return result;
  }

  function reset() {
    searchSeq += 1;
    stop();
    clearEvaluationState();
    runtime.lastEvaluatedFen = null;
    runtime.lastEvaluationKey = null;
  }

  ChessBot.stockfishEval = {
    ensureReady,
    analyzeFen,
    stop,
    reset,
    clearEvaluationState,
    isBusy: () => !!activeSearch
  };
})();
