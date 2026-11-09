// ---------------------------------------------------------------------------
// engine.js — runs Stockfish (WebAssembly, single-threaded "lite" build) in a
// Web Worker created from a Blob, so nothing has to be hosted on chess.com.
//
// The engine's .js and .wasm files are downloaded once from a CDN and cached
// with the Cache API. The .wasm bytes are handed to the worker by message and
// served to the engine through a tiny fetch() shim, which avoids any extra
// network request from inside the worker.
// ---------------------------------------------------------------------------
const Engine = (() => {
  const CACHE_NAME = 'sfo-engine-v1';

  async function fetchCached(url, type) {
    let cache = null;
    try { cache = await caches.open(CACHE_NAME); } catch (e) { cache = null; }
    if (cache) {
      try {
        const hit = await cache.match(url);
        if (hit) return type === 'text' ? hit.text() : hit.arrayBuffer();
      } catch (e) { /* ignore */ }
    }
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    if (cache) { try { await cache.put(url, res.clone()); } catch (e) { /* quota etc. */ } }
    return type === 'text' ? res.text() : res.arrayBuffer();
  }

  // Runs inside the worker before the engine code.
  const SHIM = `
    (function () {
      var resolveWasm;
      var wasmReady = new Promise(function (r) { resolveWasm = r; });
      self.addEventListener('message', function (e) {
        if (e.data && e.data.__sfoWasm) { e.stopImmediatePropagation(); resolveWasm(e.data.__sfoWasm); }
      });
      var realFetch = self.fetch ? self.fetch.bind(self) : null;
      self.fetch = function (url, opts) {
        if (/\\.wasm(\\?|#|$)/.test(String(url && url.url || url))) {
          return wasmReady.then(function (buf) {
            return new Response(buf, { headers: { 'Content-Type': 'application/wasm' } });
          });
        }
        return realFetch(url, opts);
      };
    })();
  `;

  class StockfishEngine {
    constructor(onLine) {
      this.onLine = onLine;
      this.worker = null;
      this.ready = false;
      this.readyPromise = null;
    }

    load(jsUrl, onStatus) {
      if (this.readyPromise) return this.readyPromise;
      const wasmUrl = jsUrl.replace(/\.js(\?.*)?$/i, '.wasm$1');
      this.readyPromise = (async () => {
        onStatus && onStatus('Downloading engine…');
        const [jsText, wasm] = await Promise.all([fetchCached(jsUrl, 'text'), fetchCached(wasmUrl, 'buffer')]);
        onStatus && onStatus('Starting engine…');
        const blob = new Blob([SHIM, '\n', jsText], { type: 'text/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        // The engine reads the wasm location from the URL hash; any *.wasm
        // name is fine because the shim intercepts the request.
        this.worker = new Worker(blobUrl + '#engine.wasm');
        this.worker.onerror = (e) => {
          onStatus && onStatus('Engine error: ' + (e.message || 'worker failed'));
        };
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Engine did not respond (timeout)')), 30000);
          this.worker.onmessage = (e) => {
            const line = typeof e.data === 'string' ? e.data : '';
            if (line === 'uciok') { clearTimeout(timer); resolve(); }
          };
          this.worker.postMessage({ __sfoWasm: wasm }, [wasm]);
          this.worker.postMessage('uci');
        });
        this.worker.onmessage = (e) => {
          if (typeof e.data === 'string') {
            for (const line of e.data.split('\n')) if (line) this.onLine(line);
          }
        };
        this.ready = true;
        onStatus && onStatus('Engine ready');
      })();
      this.readyPromise.catch(() => { this.readyPromise = null; });
      return this.readyPromise;
    }

    send(cmd) {
      if (this.worker) this.worker.postMessage(cmd);
    }

    terminate() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.ready = false;
      this.readyPromise = null;
    }
  }

  function parseInfo(line) {
    if (!line.startsWith('info ') || line.indexOf(' pv ') < 0) return null;
    const tok = line.split(' ');
    const info = { multipv: 1, depth: 0, pv: [] };
    for (let i = 1; i < tok.length; i++) {
      const t = tok[i];
      if (t === 'depth') info.depth = Number(tok[++i]);
      else if (t === 'seldepth') info.seldepth = Number(tok[++i]);
      else if (t === 'multipv') info.multipv = Number(tok[++i]);
      else if (t === 'nodes') info.nodes = Number(tok[++i]);
      else if (t === 'nps') info.nps = Number(tok[++i]);
      else if (t === 'time') info.time = Number(tok[++i]);
      else if (t === 'score') {
        const kind = tok[++i];
        const val = Number(tok[++i]);
        if (kind === 'cp') info.cp = val;
        else if (kind === 'mate') info.mate = val;
        if (tok[i + 1] === 'lowerbound' || tok[i + 1] === 'upperbound') info.bound = tok[++i];
      } else if (t === 'pv') { info.pv = tok.slice(i + 1); break; }
    }
    return info;
  }

  // Analysis controller: one search at a time, latest position wins.
  class Analyzer {
    constructor(callbacks) {
      this.cb = callbacks; // { onUpdate(state), onStatus(text), onBestMove(state) }
      this.engine = new StockfishEngine((l) => this._line(l));
      this.searching = false;
      this.stopping = false;
      this.pending = null;
      this.current = null;
      this.options = {};
    }

    async init(jsUrl) {
      await this.engine.load(jsUrl, (s) => this.cb.onStatus(s));
      this._applyOptions(this.options, true);
      this.engine.send('isready');
    }

    setOptions(opts) {
      const prev = this.options;
      this.options = Object.assign({}, opts);
      if (this.engine.ready) this._applyOptions(prev, false);
    }

    _applyOptions(prev, force) {
      const o = this.options;
      const set = (name, value) => this.engine.send('setoption name ' + name + ' value ' + value);
      if (force || prev.multiPv !== o.multiPv) set('MultiPV', o.multiPv);
      if (force || prev.hash !== o.hash) set('Hash', o.hash);
      if (force || prev.skill !== o.skill) set('Skill Level', o.skill);
    }

    analyze(fen) {
      this.pending = { fen, options: Object.assign({}, this.options) };
      if (!this.engine.ready) return;
      if (this.searching) {
        if (!this.stopping) { this.stopping = true; this.engine.send('stop'); }
        return;
      }
      this._start();
    }

    stop() {
      this.pending = null;
      if (this.searching && !this.stopping) { this.stopping = true; this.engine.send('stop'); }
    }

    _start() {
      const job = this.pending;
      this.pending = null;
      if (!job) return;
      const o = job.options;
      this.current = { fen: job.fen, lines: [], depth: 0, done: false, startedAt: Date.now() };
      this.searching = true;
      this.stopping = false;
      this.engine.send('position fen ' + job.fen);
      const go = o.mode === 'time' ? 'go movetime ' + o.moveTime : o.mode === 'infinite' ? 'go infinite' : 'go depth ' + o.depth;
      this.engine.send(go);
      this.cb.onUpdate(this.current);
    }

    _line(line) {
      if (line.startsWith('bestmove')) {
        this.searching = false;
        const wasStopping = this.stopping;
        this.stopping = false;
        if (this.current && !wasStopping) {
          this.current.done = true;
          this.current.bestmove = line.split(' ')[1];
          this.cb.onUpdate(this.current);
        }
        if (this.pending) this._start();
        return;
      }
      if (this.stopping || !this.current) return;
      const info = parseInfo(line);
      if (!info || !info.pv.length || info.bound) return;
      const cur = this.current;
      cur.lines[info.multipv - 1] = info;
      cur.depth = Math.max(cur.depth, info.depth);
      cur.nps = info.nps || cur.nps;
      cur.nodes = info.nodes || cur.nodes;
      // Throttle UI updates to ~10/sec.
      const now = Date.now();
      if (!this._lastEmit || now - this._lastEmit > 100) {
        this._lastEmit = now;
        this.cb.onUpdate(cur);
      } else if (!this._timer) {
        this._timer = setTimeout(() => { this._timer = null; this._lastEmit = Date.now(); this.cb.onUpdate(this.current); }, 110);
      }
    }
  }

  return { Analyzer, parseInfo, StockfishEngine };
})();
