// ---------------------------------------------------------------------------
// main.js — wires board detection, the engine, the overlay and the panel.
// ---------------------------------------------------------------------------
(() => {
  if (window.__sfoLoaded) return;
  window.__sfoLoaded = true;

  // Only bot games and the analysis board. The overlay deliberately does not
  // run in games against people (that would break Chess.com's fair-play rules).
  const SUPPORTED = /^\/(play\/computer|analysis|game\/live|live|play\/online)(\/|$|\?)/;
const LIVE_GAME = /^\/(game\/daily|daily)(\/|$|\?)/;

const isSupportedPage = () => SUPPORTED.test(location.pathname) && !LIVE_GAME.test(location.pathname);

  const ARROW_COLORS = ['accent', '#58a6ff', '#f0883e', '#bc8cff', '#8b949e'];

  const state = {
    active: false,
    board: null,
    fen: null,
    turn: 'w',
    flipped: false,
    playingAs: null,
    source: null,
    analysis: null,
    gameStatus: null,
    status: { text: 'Starting…', kind: 'busy' },
    engineStarted: false,
  };

  const analyzer = new Engine.Analyzer({
    onUpdate: (a) => { if (a.fen === state.fen) { state.analysis = a; draw(); } },
    onStatus: (text) => setStatus(text, /ready/i.test(text) ? 'ok' : /error/i.test(text) ? 'err' : 'busy'),
  });

  function engineOptions(s) {
    return { mode: s.mode, depth: s.depth, moveTime: s.moveTime, multiPv: s.multiPv, skill: s.skill, hash: s.hash };
  }

  function setStatus(text, kind) {
    state.status = { text, kind };
    draw();
  }

  async function startEngine() {
    if (state.engineStarted) return;
    state.engineStarted = true;
    const s = Settings.get();
    analyzer.setOptions(engineOptions(s));
    try {
      await analyzer.init(s.engineUrl);
      setStatus('Engine ready', 'ok');
      if (state.fen) requestAnalysis(true);
    } catch (err) {
      state.engineStarted = false;
      setStatus('Engine failed to load: ' + (err && err.message ? err.message : err) +
        '. Check your connection or the engine URL in Settings, then tap ▶.', 'err');
    }
  }

  function hideMoves() {
    const s = Settings.get();
    return s.showOn === 'myTurn' && state.playingAs && state.turn !== state.playingAs;
  }

  function requestAnalysis(force) {
    const s = Settings.get();
    if (!s.enabled || !state.fen) return;
    if (state.gameStatus) { analyzer.stop(); return; }
    if (!force && state.analysis && state.analysis.fen === state.fen) return;
    state.analysis = null;
    analyzer.analyze(state.fen);
  }

  function arrowsFor(analysis, s) {
    const arrows = [];
    const squares = [];
    if (!analysis || !state.fen || hideMoves()) return { arrows, squares };
    const seen = new Set();
    const count = Math.min(s.arrowCount, s.multiPv);
    analysis.lines.slice(0, count).forEach((line, i) => {
      if (!line || !line.pv[0]) return;
      const uci = line.pv[0];
      if (seen.has(uci)) return;
      seen.add(uci);
      const from = Chess.sqIndex(uci.slice(0, 2));
      const to = Chess.sqIndex(uci.slice(2, 4));
      if (from < 0 || to < 0) return;
      const color = ARROW_COLORS[i] === 'accent' ? s.accent : ARROW_COLORS[i];
      if (s.showArrows) {
        arrows.push({
          from, to, color,
          opacity: s.arrowOpacity * (i === 0 ? 1 : Math.max(0.45, 0.85 - i * 0.12)),
          width: i === 0 ? 20 : 14,
          label: s.showLabels && count > 1 ? String(i + 1) : '',
        });
      }
      if (i === 0 && s.showSquares) {
        squares.push({ sq: from, color: s.accent, opacity: 0.28 }, { sq: to, color: s.accent, opacity: 0.4 });
      }
    });
    return { arrows, squares };
  }

  let drawQueued = false;
  function draw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      drawNow();
    });
  }

  function drawNow() {
    const s = Settings.get();
    Panel.setVisible(state.active);
    if (!state.active) return;
    let message = '';
    if (!state.board) message = 'Looking for the board…';
    else if (!state.fen) message = 'Could not read this position yet.';
    else if (state.gameStatus === 'checkmate') message = 'Checkmate — ' + (state.turn === 'w' ? 'Black' : 'White') + ' wins.';
    else if (state.gameStatus === 'stalemate') message = 'Stalemate — draw.';
    else if (!s.enabled) message = 'Analysis paused. Tap ▶ to resume.';
    else if (hideMoves()) message = 'Opponent to move…';

    const analysis = s.enabled && state.analysis && state.analysis.fen === state.fen ? state.analysis : null;
    if (Panel.host) Panel.host.dataset.fen = state.fen || ''; // handy for debugging / tests
    Panel.fitDocked(state.board);
    Panel.render({
      status: state.status, analysis, fen: state.fen, turn: state.turn, flipped: state.flipped,
      hideMoves: hideMoves(), message, source: state.source,
    });

    if (state.board) {
      if (!s.enabled) { BoardOverlay.clear(state.board); return; }
      const { arrows, squares } = arrowsFor(analysis, s);
      const top = analysis && analysis.lines[0];
      BoardOverlay.draw(state.board, {
        arrows, squares, flipped: state.flipped,
        evalBar: s.showBoardEvalBar && top ? Panel.whiteShare(top, state.turn) : null,
      });
    }
  }

  // ---- Board polling ---------------------------------------------------------
  let observer = null;
  let observedBoard = null;

  function observe(board) {
    if (observedBoard === board) return;
    if (observer) observer.disconnect();
    observedBoard = board;
    if (!board) return;
    let t = null;
    observer = new MutationObserver((records) => {
      // Ignore our own overlay redraws.
      if (records.every((r) => r.target.closest && r.target.closest('#sfo-board-overlay'))) return;
      clearTimeout(t);
      t = setTimeout(tick, 60);
    });
    observer.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function tick() {
    const active = isSupportedPage();
    if (active !== state.active) {
      state.active = active;
      if (!active) {
        analyzer.stop();
        if (state.board) BoardOverlay.clear(state.board);
        observe(null);
        state.board = null;
        state.fen = null;
        state.analysis = null;
      }
    }
    if (!active) { draw(); return; }
    if (Settings.get().enabled && !state.engineStarted) startEngine();

    const info = BoardReader.read();
    const board = info ? info.board : null;
    if (board !== state.board) {
      if (state.board) BoardOverlay.clear(state.board);
      state.board = board;
    }
    observe(board);
    if (!info) { state.fen = null; draw(); return; }

    state.flipped = info.flipped;
    state.playingAs = info.playingAs;
    state.source = info.source;
    if (info.fen && info.fen !== state.fen) {
      state.fen = info.fen;
      const pos = Chess.parseFen(info.fen);
      state.turn = pos.turn;
      state.gameStatus = Chess.gameStatus(pos);
      requestAnalysis(false);
    } else if (!info.fen) {
      state.fen = null;
    }
    draw();
  }

  // ---- Settings changes ------------------------------------------------------
  const ENGINE_KEYS = ['mode', 'depth', 'moveTime', 'multiPv', 'skill', 'hash'];
  Settings.onChange((s, prev) => {
    Panel.applySettings(s);
    if (ENGINE_KEYS.some((k) => s[k] !== prev[k])) {
      analyzer.setOptions(engineOptions(s));
      if (state.fen) requestAnalysis(true);
    }
    if (s.engineUrl !== prev.engineUrl && prev.engineUrl !== undefined) {
      analyzer.engine.terminate();
      state.engineStarted = false;
    }
    if (s.enabled !== prev.enabled) {
      if (s.enabled) {
        if (!state.engineStarted) startEngine();
        requestAnalysis(true);
      } else analyzer.stop();
    }
    draw();
  });

  async function handleAction(act) {
    if (act === 'reset') {
      if (confirm('Reset all Stockfish overlay settings?')) Settings.reset();
    } else if (act === 'clear-cache') {
      try { await caches.delete('sfo-engine-v1'); } catch (e) { /* ignore */ }
      analyzer.engine.terminate();
      state.engineStarted = false;
      startEngine();
    }
  }

  // ---- Boot ------------------------------------------------------------------
  function boot() {
    Settings.load();
    Panel.mount(handleAction);
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.code === 'KeyS' || e.key === 'S')) {
        Settings.set({ panelVisible: !Settings.get().panelVisible });
        e.preventDefault();
      }
    });
    tick();
    setInterval(tick, 700);
    // SPA navigation: react quickly to URL changes.
    for (const fn of ['pushState', 'replaceState']) {
      const orig = history[fn];
      history[fn] = function () { const r = orig.apply(this, arguments); setTimeout(tick, 50); return r; };
    }
    window.addEventListener('popstate', () => setTimeout(tick, 50));
    // iOS Safari suspends background tabs; restart analysis when visible again.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); requestAnalysis(true); } });
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
