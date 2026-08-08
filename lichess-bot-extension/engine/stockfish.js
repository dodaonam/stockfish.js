(function () {
  const root = window.LichessCoach;
  const config = root.config;
  const cacheName = 'lichess-stockfish-coach-cache-v2';
  let dbPromise;
  let workerUrlPromise;

  function request(url, responseType) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'ENGINE_FETCH', url, responseType }, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || 'Engine fetch failed'));
        resolve(response.data);
      });
    });
  }
  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(cacheName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'url' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function cached(url, type) {
    try {
      const db = await openDb();
      const hit = await new Promise((resolve, reject) => { const req = db.transaction('files').objectStore('files').get(url); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      if (hit?.type === type) return hit.data;
    } catch (_) {}
    const response = await request(url, type === 'binary' ? 'arraybuffer' : 'text');
    const data = type === 'binary' ? decodeBase64(response) : response;
    try {
      const db = await openDb();
      db.transaction('files', 'readwrite').objectStore('files').put({ url, type, data });
    } catch (_) {}
    return data;
  }
  async function workerUrl() {
    if (workerUrlPromise) return workerUrlPromise;
    workerUrlPromise = (async () => {
      const base = config.stockfishBaseUrl;
      const scriptUrl = base + config.stockfishScript;
      const source = await cached(scriptUrl, 'text');
      const wasmUrls = Array.from({ length: config.stockfishWasmPartCount }, (_, i) => `${base}stockfish-17.1-single-a496a04-part-${i}.wasm`);
      const redirects = {};
      const results = await Promise.all(wasmUrls.map(async url => {
        try { return [url, await cached(url, 'binary')]; }
        catch (error) { root.logger.warn('WASM part unavailable', url, error.message); return null; }
      }));
      for (const item of results) {
        if (!item) continue;
        const blobUrl = URL.createObjectURL(new Blob([item[1]], { type: 'application/wasm' }));
        redirects[item[0]] = blobUrl;
      }
      if (!Object.keys(redirects).length) throw new Error('No Stockfish WASM part could be loaded');
      const pattern = 'a=decodeURIComponent(e[0]||location.origin+location.pathname.replace(/\\.js$/i,".wasm"))';
      if (!source.includes(pattern)) throw new Error('Unexpected Stockfish bootstrap format');
      const wasmUrl = base + config.stockfishWasm;
      const patched = source.replace(pattern, `a='${wasmUrl}'`);
      const prelude = `const R=${JSON.stringify(redirects)};const F=self.fetch.bind(self);self.fetch=function(i,n){const r=typeof i==='string'?i:(i&&i.url)||'';let k=[r];try{const u=new URL(r,self.location.href);k.push(u.href,u.pathname,u.pathname.split('/').pop())}catch(_){}for(const x of k)if(R[x])return F(R[x],n);return F(i,n)};self.Module=self.Module||{};self.Module.locateFile=self.Module.locateFile||function(path){return path&&path.endsWith('.wasm')?'${wasmUrl}':path};`;
      return URL.createObjectURL(new Blob([prelude, patched], { type: 'application/javascript' }));
    })().catch(error => { workerUrlPromise = null; throw error; });
    return workerUrlPromise;
  }

  class Engine {
    constructor() { this.worker = null; this.current = null; this.nextJob = null; this.lines = new Map(); this.ready = false; this.booting = false; }
    async ensureReady() {
      if (this.ready) return;
      if (this.booting) return;
      this.booting = true; root.state.engine.status = 'loading'; root.ui?.render();
      try {
        this.worker = new Worker(await workerUrl());
        this.worker.onmessage = event => this.handle(String(event.data || ''));
        this.worker.onerror = error => {
          this.ready = false; this.booting = false; this.current = null; this.nextJob = null;
          root.state.engine.status = 'error'; root.state.engine.error = error.message || 'Worker error'; root.ui?.render();
        };
        this.send('uci');
      } catch (error) { root.state.engine.status = 'error'; root.state.engine.error = error.message; root.ui?.render(); }
      this.booting = false;
    }
    send(command) { this.worker?.postMessage(command); }
    handle(message) {
      if (message === 'uciok') { this.send(`setoption name Threads value ${config.engineThreads}`); this.send(`setoption name Hash value ${config.engineHashMb}`); this.send(`setoption name MultiPV value ${config.multipv}`); this.send('isready'); return; }
      if (message === 'readyok') {
        this.ready = true; this.booting = false; root.state.engine.status = 'ready'; root.ui?.render();
        this.startNext();
        return;
      }
      if (!this.current) return;
      if (message.startsWith('info ')) { const line = root.uci.info(message); if (!line) return; this.lines.set(line.multipv, line); root.state.engine.analysis = { fen: this.current.fen, lines: [...this.lines.values()].sort((a, b) => a.multipv - b.multipv), complete: false }; root.ui?.render(); return; }
      if (message.startsWith('bestmove ')) { const bestMove = root.uci.bestMove(message); root.state.engine.analysis = { fen: this.current.fen, lines: [...this.lines.values()].sort((a, b) => a.multipv - b.multipv), bestMove, complete: true }; this.current = null; this.lines.clear(); root.state.engine.status = 'ready'; root.ui?.render(); this.startNext(); }
    }
    startNext() {
      if (!this.ready || this.current || !this.nextJob) return;
      const job = this.nextJob;
      this.nextJob = null;
      this.current = job;
      this.lines.clear();
      root.state.engine.status = 'searching';
      root.state.engine.analysis = { fen: job.fen, lines: [], complete: false };
      this.send(`position fen ${job.fen}`);
      this.send(`go depth ${root.state.ui.depth}`);
      root.ui?.render();
    }
    search(job) {
      this.nextJob = job;
      if (!this.ready) this.ensureReady();
      this.startNext();
    }
    cancel() { if (this.current) this.send('stop'); this.current = null; this.nextJob = null; this.lines.clear(); root.state.engine.analysis = null; if (this.ready) root.state.engine.status = 'ready'; }
    destroy() { try { this.worker?.terminate(); } catch (_) {} this.worker = null; this.current = null; this.nextJob = null; this.ready = false; this.booting = false; this.lines.clear(); }
  }
  root.engine = new Engine();
})();
