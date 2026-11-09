// ---------------------------------------------------------------------------
// panel.js — the floating / docked analysis panel and its settings view.
// Lives in a Shadow DOM so Chess.com's CSS cannot leak in (or out).
// ---------------------------------------------------------------------------
const Panel = (() => {
  const ACCENTS = [
    ['#3fb950', 'Green'], ['#58a6ff', 'Blue'], ['#bc8cff', 'Purple'],
    ['#f0883e', 'Orange'], ['#ff7b72', 'Red'], ['#e3b341', 'Gold'],
  ];

  const SCHEMA = [
    { title: 'Engine', items: [
      { key: 'mode', type: 'select', label: 'Search', options: [['depth', 'Fixed depth'], ['time', 'Time per move'], ['infinite', 'Infinite']] },
      { key: 'depth', type: 'range', label: 'Depth', min: 6, max: 30, show: (s) => s.mode === 'depth' },
      { key: 'moveTime', type: 'range', label: 'Time per move', min: 200, max: 10000, step: 100, fmt: (v) => (v / 1000).toFixed(1) + ' s', show: (s) => s.mode === 'time' },
      { key: 'multiPv', type: 'range', label: 'Candidate lines', min: 1, max: 5 },
      { key: 'skill', type: 'range', label: 'Engine strength (skill)', min: 0, max: 20, fmt: (v) => (v === 20 ? 'Max' : v) },
      { key: 'hash', type: 'select', label: 'Hash memory', options: [[16, '16 MB'], [32, '32 MB'], [64, '64 MB'], [128, '128 MB']], num: true },
    ] },
    { title: 'Board', items: [
      { key: 'showOn', type: 'select', label: 'Show suggestions', options: [['always', 'Every move'], ['myTurn', 'Only on my turn']] },
      { key: 'showArrows', type: 'toggle', label: 'Arrows' },
      { key: 'arrowCount', type: 'range', label: 'Number of arrows', min: 1, max: 5, show: (s) => s.showArrows },
      { key: 'showLabels', type: 'toggle', label: 'Number the arrows', show: (s) => s.showArrows },
      { key: 'arrowOpacity', type: 'range', label: 'Arrow opacity', min: 0.2, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', show: (s) => s.showArrows },
      { key: 'showSquares', type: 'toggle', label: 'Highlight best-move squares' },
      { key: 'showBoardEvalBar', type: 'toggle', label: 'Eval bar on board' },
    ] },
    { title: 'Panel', items: [
      { key: 'theme', type: 'select', label: 'Theme', options: [['auto', 'Match system'], ['dark', 'Dark'], ['light', 'Light']] },
      { key: 'accent', type: 'swatch', label: 'Accent colour' },
      { key: 'panelOpacity', type: 'range', label: 'Panel transparency', min: 0.3, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'fontScale', type: 'range', label: 'Text size', min: 0.85, max: 1.4, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'layout', type: 'select', label: 'Layout', options: [['auto', 'Automatic'], ['floating', 'Floating window'], ['docked', 'Docked to bottom']] },
      { key: 'showLines', type: 'toggle', label: 'Show engine lines' },
      { key: 'lineLength', type: 'range', label: 'Moves per line', min: 2, max: 20, show: (s) => s.showLines },
    ] },
    { title: 'Advanced', items: [
      { key: 'engineUrl', type: 'text', label: 'Engine URL (stockfish …-single.js)' },
      { type: 'buttons', buttons: [['clear-cache', 'Re-download engine'], ['reset', 'Reset settings']] },
    ] },
  ];

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      --bg: 22, 24, 28; --fg: #e6edf3; --muted: #9aa4b2; --line: rgba(255,255,255,.09);
      --chip: rgba(255,255,255,.07); --accent: #3fb950; --op: .95; --fs: 1;
      font: calc(13px * var(--fs)) / 1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--fg); -webkit-text-size-adjust: 100%;
    }
    .wrap.light {
      --bg: 250, 250, 252; --fg: #1f2328; --muted: #59636e; --line: rgba(0,0,0,.1); --chip: rgba(0,0,0,.05);
    }
    .panel {
      position: fixed; z-index: 2147483000; background: rgba(var(--bg), var(--op));
      border: 1px solid var(--line); box-shadow: 0 10px 30px rgba(0,0,0,.35);
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      display: flex; flex-direction: column; overflow: hidden; touch-action: manipulation;
    }
    .panel.floating { width: 340px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 12px; }
    .panel.docked {
      left: 0; right: 0; bottom: 0; border-radius: 14px 14px 0 0; max-height: 55vh;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .panel.hidden, .fab.hidden { display: none; }
    .header {
      display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 12px; min-height: 44px;
      border-bottom: 1px solid var(--line); user-select: none; -webkit-user-select: none;
    }
    .panel.floating .header { cursor: grab; touch-action: none; }
    .panel.collapsed .header { border-bottom: 0; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
    .dot.ok { background: var(--accent); } .dot.busy { background: #e3b341; animation: pulse 1s infinite; }
    .dot.err { background: #ff7b72; }
    @keyframes pulse { 50% { opacity: .35; } }
    .title { font-weight: 650; white-space: nowrap; }
    .eval {
      font-weight: 700; font-variant-numeric: tabular-nums; padding: 2px 8px; border-radius: 6px;
      background: #f0f0f0; color: #111; min-width: 54px; text-align: center;
    }
    .eval.black { background: #262421; color: #f0f0f0; border: 1px solid var(--line); }
    .light .eval, .light .chip { border: 1px solid rgba(0,0,0,.18); }
    .panel.floating button { min-width: 30px; height: 30px; padding: 0 6px; }
    .panel.docked .best { display: none; }
    .panel.docked .summary { padding-top: 8px; }
    .panel.docked .lines li { padding: 4px; }
    @media (max-width: 440px) { .panel.docked .title { display: none; } }
    .hbest { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .spacer { flex: 1; }
    button {
      font: inherit; color: var(--fg); background: var(--chip); border: 1px solid var(--line);
      border-radius: 8px; min-width: 34px; height: 34px; padding: 0 8px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; flex: none;
    }
    button:active { transform: scale(.96); }
    button.on { border-color: var(--accent); color: var(--accent); }
    .body { overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
    .panel.collapsed .body { display: none; }
    .summary { padding: 10px 12px 6px; }
    .bar { position: relative; height: 10px; border-radius: 5px; background: #262421; overflow: hidden; border: 1px solid var(--line); }
    .bar > i { position: absolute; left: 0; top: 0; bottom: 0; background: #f0f0f0; transition: width .3s ease; }
    .bar.flip > i { left: auto; right: 0; }
    .best { display: flex; align-items: baseline; gap: 8px; margin-top: 10px; }
    .best .label { color: var(--muted); }
    .best .move { font-size: 1.55em; font-weight: 750; color: var(--accent); }
    .stats { color: var(--muted); font-size: .9em; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .msg { padding: 10px 12px; color: var(--muted); }
    .msg.err { color: #ff7b72; }
    .lines { list-style: none; margin: 0; padding: 4px 8px 10px; }
    .lines li { display: flex; gap: 8px; padding: 6px 4px; border-top: 1px solid var(--line); align-items: baseline; }
    .lines li:first-child { border-top: 0; }
    .chip {
      flex: none; font-weight: 700; font-variant-numeric: tabular-nums; font-size: .92em;
      padding: 1px 6px; border-radius: 5px; min-width: 52px; text-align: center; background: #f0f0f0; color: #111;
    }
    .chip.black { background: #262421; color: #f0f0f0; border: 1px solid var(--line); }
    .pv { overflow-wrap: anywhere; }
    .pv b { color: var(--accent); }
    .settings { padding: 4px 12px 12px; }
    .settings h4 { margin: 14px 0 6px; font-size: .78em; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px; }
    .row label { flex: 1; }
    .row .val { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 42px; text-align: right; }
    .row.col { flex-direction: column; align-items: stretch; gap: 4px; padding: 4px 0; }
    .row.col .top { display: flex; justify-content: space-between; }
    input[type=range] { width: 100%; accent-color: var(--accent); height: 28px; }
    select, input[type=text] {
      font: inherit; font-size: max(16px, 1em); color: var(--fg); background: var(--chip); border: 1px solid var(--line);
      border-radius: 8px; padding: 6px 8px; max-width: 60%;
    }
    input[type=text] { max-width: 100%; width: 100%; font-size: 16px; }
    select option { color: #111; }
    .switch { position: relative; width: 46px; height: 28px; flex: none; }
    .switch input { opacity: 0; width: 100%; height: 100%; margin: 0; position: absolute; cursor: pointer; z-index: 1; }
    .switch span { position: absolute; inset: 0; border-radius: 14px; background: var(--chip); border: 1px solid var(--line); transition: .2s; }
    .switch span::after { content: ""; position: absolute; width: 22px; height: 22px; left: 2px; top: 2px; border-radius: 50%; background: #fff; transition: .2s; box-shadow: 0 1px 3px rgba(0,0,0,.4); }
    .switch input:checked + span { background: var(--accent); }
    .switch input:checked + span::after { transform: translateX(18px); }
    .swatches { display: flex; gap: 8px; flex-wrap: wrap; }
    .swatches button { width: 30px; min-width: 30px; height: 30px; border-radius: 50%; padding: 0; border: 2px solid transparent; }
    .swatches button.sel { border-color: var(--fg); }
    .btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .btns button { padding: 0 12px; }
    .note { color: var(--muted); font-size: .85em; margin-top: 10px; }
    .fab {
      position: fixed; z-index: 2147483000; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px));
      width: 48px; height: 48px; border-radius: 50%; font-size: 24px; border: 2px solid var(--accent);
      background: rgba(var(--bg), .95); color: var(--fg); box-shadow: 0 6px 18px rgba(0,0,0,.35);
    }
  `;

  const ICONS = {
    gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 15l6-6 6 6"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 6l-6 6 6 6"/></svg>',
  };

  let host, root, wrap, panel, fab, els = {};
  let view = 'analysis';
  let liveSliding = false; // don't rebuild the settings form while a slider is being dragged
  let onAction = () => {};

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(actionHandler) {
    onAction = actionHandler;
    host = document.createElement('div');
    host.id = 'sfo-root';
    root = host.attachShadow({ mode: 'open' });
    root.appendChild(h('<style>' + CSS + '</style>'));
    wrap = h('<div class="wrap"></div>');
    root.appendChild(wrap);
    panel = h(`
      <div class="panel" role="complementary" aria-label="Stockfish analysis">
        <div class="header">
          <span class="dot"></span>
          <span class="title">Stockfish</span>
          <span class="eval" title="Evaluation (White's point of view)">–</span>
          <span class="hbest"></span>
          <span class="spacer"></span>
          <button data-act="pause" title="Pause / resume analysis"></button>
          <button data-act="settings" title="Settings">${ICONS.gear}</button>
          <button data-act="collapse" title="Collapse"></button>
          <button data-act="hide" title="Hide panel">${ICONS.close}</button>
        </div>
        <div class="body">
          <div class="analysis">
            <div class="summary">
              <div class="bar"><i style="width:50%"></i></div>
              <div class="best"><span class="label">Best move</span><span class="move">…</span></div>
              <div class="stats"></div>
            </div>
            <div class="msg"></div>
            <ol class="lines"></ol>
          </div>
          <div class="settings" hidden></div>
        </div>
      </div>`);
    fab = h(`<button class="fab hidden" title="Show Stockfish panel" aria-label="Show Stockfish panel">♞</button>`);
    wrap.append(panel, fab);
    els = {
      dot: panel.querySelector('.dot'), eval: panel.querySelector('.eval'), hbest: panel.querySelector('.hbest'),
      pause: panel.querySelector('[data-act=pause]'), collapse: panel.querySelector('[data-act=collapse]'),
      settingsBtn: panel.querySelector('[data-act=settings]'),
      header: panel.querySelector('.header'), body: panel.querySelector('.body'),
      analysis: panel.querySelector('.analysis'), settings: panel.querySelector('.settings'),
      summary: panel.querySelector('.summary'), bar: panel.querySelector('.bar'), barFill: panel.querySelector('.bar > i'),
      best: panel.querySelector('.best .move'), stats: panel.querySelector('.stats'),
      msg: panel.querySelector('.msg'), lines: panel.querySelector('.lines'),
    };

    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const s = Settings.get();
      if (act === 'pause') Settings.set({ enabled: !s.enabled });
      else if (act === 'collapse') Settings.set({ collapsed: !s.collapsed });
      else if (act === 'hide') Settings.set({ panelVisible: false });
      else if (act === 'settings') { view = view === 'settings' ? 'analysis' : 'settings'; if (s.collapsed) Settings.set({ collapsed: false }); applyView(); }
      else onAction(act);
    });
    fab.addEventListener('click', () => Settings.set({ panelVisible: true }));
    setupDrag();
    document.documentElement.appendChild(host);
    window.addEventListener('resize', () => applySettings(Settings.get()));
    applySettings(Settings.get());
  }

  function setupDrag() {
    let start = null;
    els.header.addEventListener('pointerdown', (e) => {
      if (!panel.classList.contains('floating') || e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, id: e.pointerId };
      els.header.setPointerCapture(e.pointerId);
      els.header.style.cursor = 'grabbing';
    });
    els.header.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const pos = clampPos(start.left + e.clientX - start.x, start.top + e.clientY - start.y);
      panel.style.left = pos.x + 'px';
      panel.style.top = pos.y + 'px';
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      els.header.style.cursor = '';
      Settings.set({ panelX: parseFloat(panel.style.left), panelY: parseFloat(panel.style.top) });
    };
    els.header.addEventListener('pointerup', end);
    els.header.addEventListener('pointercancel', end);
  }

  function clampPos(x, y) {
    const w = panel.offsetWidth || 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return { x: Math.max(4, Math.min(vw - w - 4, x)), y: Math.max(4, Math.min(vh - 48, y)) };
  }

  function isDark(s) {
    if (s.theme === 'dark') return true;
    if (s.theme === 'light') return false;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return true; }
  }

  function applySettings(s) {
    if (!panel) return;
    wrap.classList.toggle('light', !isDark(s));
    wrap.style.setProperty('--accent', s.accent);
    wrap.style.setProperty('--op', s.panelOpacity);
    wrap.style.setProperty('--fs', s.fontScale);
    const layout = Settings.layout();
    panel.classList.toggle('floating', layout === 'floating');
    panel.classList.toggle('docked', layout === 'docked');
    panel.classList.toggle('collapsed', !!s.collapsed);
    if (layout === 'floating') {
      const x = s.panelX ?? window.innerWidth - 340;
      const y = s.panelY ?? 80;
      const pos = clampPos(x, y);
      panel.style.left = pos.x + 'px';
      panel.style.top = pos.y + 'px';
      panel.style.right = panel.style.bottom = '';
    } else {
      panel.style.left = panel.style.top = '';
    }
    els.pause.innerHTML = s.enabled ? ICONS.pause : ICONS.play;
    els.pause.classList.toggle('on', !s.enabled);
    els.pause.title = s.enabled ? 'Pause analysis' : 'Resume analysis';
    els.collapse.innerHTML = s.collapsed ? (layout === 'docked' ? ICONS.up : ICONS.down) : (layout === 'docked' ? ICONS.down : ICONS.up);
    els.collapse.title = s.collapsed ? 'Expand' : 'Collapse';
    els.lines.hidden = !s.showLines;
    if (view === 'settings' && !liveSliding) renderSettings();
  }

  // When docked, try to use only the space below the board.
  function fitDocked(board) {
    if (!panel || !panel.classList.contains('docked')) { if (panel) panel.style.maxHeight = ''; return; }
    let max = window.innerHeight * 0.55;
    if (board) {
      const below = window.innerHeight - board.getBoundingClientRect().bottom - 4;
      if (below >= 150) max = Math.min(max, below);
      else max = Math.min(max, Math.max(150, window.innerHeight * 0.32));
    }
    panel.style.maxHeight = Math.round(max) + 'px';
  }

  function setVisible(pageActive) {
    if (!panel) return;
    const s = Settings.get();
    host.style.display = pageActive ? '' : 'none';
    panel.classList.toggle('hidden', !s.panelVisible);
    fab.classList.toggle('hidden', s.panelVisible);
  }

  function applyView() {
    const settings = view === 'settings';
    els.analysis.hidden = settings;
    els.settings.hidden = !settings;
    els.settingsBtn.innerHTML = settings ? ICONS.back : ICONS.gear;
    els.settingsBtn.classList.toggle('on', settings);
    if (settings) renderSettings();
  }

  // ---- Settings view -------------------------------------------------------
  function renderSettings() {
    const s = Settings.get();
    const focused = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.key : null;
    let html = '';
    for (const sec of SCHEMA) {
      html += `<h4>${esc(sec.title)}</h4>`;
      for (const it of sec.items) {
        if (it.show && !it.show(s)) continue;
        const v = s[it.key];
        if (it.type === 'toggle') {
          html += `<div class="row"><label for="sfo-${it.key}">${esc(it.label)}</label>
            <span class="switch"><input type="checkbox" id="sfo-${it.key}" data-key="${it.key}" ${v ? 'checked' : ''}><span></span></span></div>`;
        } else if (it.type === 'range') {
          html += `<div class="row col"><div class="top"><label for="sfo-${it.key}">${esc(it.label)}</label>
            <span class="val">${esc(it.fmt ? it.fmt(v) : v)}</span></div>
            <input type="range" id="sfo-${it.key}" data-key="${it.key}" min="${it.min}" max="${it.max}" step="${it.step || 1}" value="${v}"></div>`;
        } else if (it.type === 'select') {
          html += `<div class="row"><label for="sfo-${it.key}">${esc(it.label)}</label><select id="sfo-${it.key}" data-key="${it.key}" ${it.num ? 'data-num="1"' : ''}>
            ${it.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}
            </select></div>`;
        } else if (it.type === 'swatch') {
          html += `<div class="row"><label>${esc(it.label)}</label><div class="swatches">
            ${ACCENTS.map(([c, n]) => `<button data-swatch="${c}" title="${n}" aria-label="${n}" class="${c === v ? 'sel' : ''}" style="background:${c}"></button>`).join('')}
            </div></div>`;
        } else if (it.type === 'text') {
          html += `<div class="row col"><label for="sfo-${it.key}">${esc(it.label)}</label>
            <input type="text" id="sfo-${it.key}" data-key="${it.key}" value="${esc(v)}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>`;
        } else if (it.type === 'buttons') {
          html += `<div class="btns">${it.buttons.map(([a, l]) => `<button data-act="${a}">${esc(l)}</button>`).join('')}</div>`;
        }
      }
    }
    html += `<div class="note">Analysis runs locally on this device. The overlay only runs on Chess.com's
      "Play vs Computer" and Analysis pages. Shortcut: Alt+Shift+S shows or hides the panel.</div>`;
    els.settings.innerHTML = html;
    if (focused) {
      const el = els.settings.querySelector(`[data-key="${focused}"]`);
      if (el && el.type === 'range') el.focus({ preventScroll: true });
    }
  }

  function bindSettingsEvents() {
    els.settings.addEventListener('input', (e) => {
      const t = e.target;
      if (t.type !== 'range') return;
      const val = Number(t.value);
      const it = SCHEMA.flatMap((sec) => sec.items).find((i) => i.key === t.dataset.key);
      const out = t.closest('.row').querySelector('.val');
      if (out && it) out.textContent = it.fmt ? it.fmt(val) : val;
      // Live preview for cosmetic sliders.
      if (['panelOpacity', 'fontScale', 'arrowOpacity'].includes(t.dataset.key)) {
        liveSliding = true;
        try { Settings.set({ [t.dataset.key]: val }); } finally { liveSliding = false; }
      }
    });
    els.settings.addEventListener('change', (e) => {
      const t = e.target;
      const key = t.dataset.key;
      if (!key) return;
      let val;
      if (t.type === 'checkbox') val = t.checked;
      else if (t.type === 'range') val = Number(t.value);
      else if (t.tagName === 'SELECT') val = t.dataset.num ? Number(t.value) : t.value;
      else val = t.value.trim();
      Settings.set({ [key]: val });
    });
    els.settings.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-swatch]');
      if (sw) Settings.set({ accent: sw.dataset.swatch });
    });
  }

  // ---- Analysis view -------------------------------------------------------
  function evalText(line, turn) {
    if (!line) return { text: '–', black: false };
    if (line.mate !== undefined) {
      const m = turn === 'w' ? line.mate : -line.mate;
      if (m === 0) return { text: '#', black: turn === 'w' };
      return { text: (m > 0 ? 'M' : '-M') + Math.abs(m), black: m < 0 };
    }
    const cp = turn === 'w' ? line.cp : -line.cp;
    return { text: (cp > 0 ? '+' : cp < 0 ? '−' : '') + (Math.abs(cp) / 100).toFixed(2), black: cp < 0 };
  }

  // White's share of the eval bar, 0..1.
  function whiteShare(line, turn) {
    if (!line) return 0.5;
    if (line.mate !== undefined) {
      const m = turn === 'w' ? line.mate : -line.mate;
      if (m === 0) return turn === 'w' ? 0 : 1;
      return m > 0 ? 1 : 0;
    }
    const cp = turn === 'w' ? line.cp : -line.cp;
    return 0.5 + 0.5 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }

  function fmtNps(n) {
    if (!n) return '';
    return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M nps' : Math.round(n / 1e3) + 'k nps';
  }

  // state: { status: {text, kind}, analysis, fen, turn, hideMoves, flipped, message }
  function render(state) {
    if (!panel) return;
    const s = Settings.get();
    const { analysis, fen, turn } = state;
    els.dot.className = 'dot ' + (state.status.kind || '');
    els.dot.title = state.status.text || '';

    const top = analysis && analysis.lines[0];
    const ev = evalText(top, turn);
    els.eval.textContent = ev.text;
    els.eval.classList.toggle('black', ev.black);
    els.barFill.style.width = (whiteShare(top, turn) * 100).toFixed(1) + '%';
    els.bar.classList.toggle('flip', !!state.flipped);

    const msg = state.message || (state.status.kind === 'err' ? state.status.text : '');
    els.msg.textContent = msg;
    els.msg.className = 'msg' + (state.status.kind === 'err' ? ' err' : '');
    els.msg.hidden = !msg;

    let bestSan = '';
    if (top && fen && !state.hideMoves) {
      const mv = Chess.pvToSan(fen, top.pv.slice(0, 1));
      bestSan = mv.length ? mv[0].san : '';
    }
    els.best.textContent = state.hideMoves ? '—' : (bestSan || (analysis ? '…' : '–'));
    els.hbest.textContent = (s.collapsed || Settings.layout() === 'docked') && bestSan ? bestSan : '';
    const stats = [];
    if (analysis && analysis.depth) {
      stats.push('Depth ' + analysis.depth + (s.mode === 'depth' ? '/' + s.depth : ''));
      if (analysis.nps) stats.push(fmtNps(analysis.nps));
      if (analysis.done) stats.push('done');
    }
    if (state.source) stats.push(state.source === 'api' ? 'board: live' : 'board: DOM');
    els.stats.textContent = stats.join(' · ');
    els.summary.hidden = !fen && !analysis;

    // Lines
    if (s.showLines && analysis && fen) {
      const items = [];
      analysis.lines.slice(0, s.multiPv).forEach((ln) => {
        if (!ln) return;
        const e = evalText(ln, turn);
        const moves = state.hideMoves ? [] : Chess.pvToSan(fen, ln.pv, s.lineLength);
        const text = moves.length ? esc(Chess.formatLine(moves)).replace(/^(\d+\.(?:\.\.)? )(\S+)/, '$1<b>$2</b>') : '<span style="opacity:.6">hidden until your turn</span>';
        items.push(`<li><span class="chip ${e.black ? 'black' : ''}">${esc(e.text)}</span><span class="pv">${text}</span></li>`);
      });
      els.lines.innerHTML = items.join('');
    } else {
      els.lines.innerHTML = '';
    }
  }

  return {
    mount: (handler) => { mount(handler); bindSettingsEvents(); },
    render, applySettings, setVisible, fitDocked, evalText, whiteShare,
    get host() { return host; },
  };
})();
