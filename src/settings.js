// ---------------------------------------------------------------------------
// settings.js — user preferences, persisted in localStorage.
// ---------------------------------------------------------------------------
const Settings = (() => {
  const KEY = 'sfo-settings-v1';
  const isNarrow = () => Math.min(window.innerWidth, screen.width || window.innerWidth) < 700;

  const DEFAULTS = {
    enabled: true,           // master switch: analysis + overlay
    panelVisible: true,
    collapsed: false,
    layout: 'auto',          // auto | floating | docked
    panelX: null, panelY: null,

    // Engine
    engineUrl: 'https://cdn.jsdelivr.net/npm/stockfish@19.0.1/bin/stockfish-19-lite-single.js',
    mode: 'depth',           // depth | time | infinite
    depth: 18,
    moveTime: 1500,
    multiPv: 3,
    skill: 20,
    hash: 16,

    // What to show
    showOn: 'always',        // always | myTurn
    showArrows: true,
    arrowCount: 3,
    showSquares: true,
    showLabels: true,
    showBoardEvalBar: true,
    showLines: true,
    lineLength: 8,

    // Appearance
    theme: 'auto',           // auto | dark | light
    accent: '#3fb950',
    panelOpacity: 0.95,
    arrowOpacity: 0.8,
    fontScale: 1,
  };

  let current = Object.assign({}, DEFAULTS);
  const listeners = new Set();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) current = Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { current = Object.assign({}, DEFAULTS); }
    return current;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (e) { /* private mode */ }
  }

  function set(patch) {
    const prev = current;
    current = Object.assign({}, current, patch);
    save();
    for (const fn of listeners) fn(current, prev);
  }

  function reset() {
    const keep = { panelVisible: true, enabled: true };
    current = Object.assign({}, DEFAULTS, keep);
    save();
    for (const fn of listeners) fn(current, {});
  }

  function layout() {
    if (current.layout === 'auto') return isNarrow() ? 'docked' : 'floating';
    return current.layout;
  }

  return {
    DEFAULTS, load, set, reset, layout,
    get: () => current,
    onChange: (fn) => listeners.add(fn),
  };
})();
