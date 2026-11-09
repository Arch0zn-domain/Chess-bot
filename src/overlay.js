// ---------------------------------------------------------------------------
// overlay.js — draws arrows and square highlights on top of the board.
// An <svg> is placed inside the board element (absolute, inset 0, no pointer
// events), so it follows the board through any resize or layout change.
// ---------------------------------------------------------------------------
const BoardOverlay = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const ID = 'sfo-board-overlay';

  function ensure(board) {
    let svg = board.querySelector(':scope > #' + ID);
    if (svg) return svg;
    if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
    svg = document.createElementNS(NS, 'svg');
    svg.id = ID;
    svg.setAttribute('viewBox', '0 0 800 800');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    Object.assign(svg.style, {
      position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '50', overflow: 'visible',
    });
    board.appendChild(svg);
    return svg;
  }

  // Centre of a square (0..63, a1 = 0) in the 800x800 viewBox.
  function center(sq, flipped) {
    const f = sq & 7;
    const r = sq >> 3;
    const x = flipped ? 7 - f : f;
    const y = flipped ? r : 7 - r;
    return [x * 100 + 50, y * 100 + 50];
  }

  function el(name, attrs) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function arrowPath(from, to, flipped, width) {
    const [x1, y1] = center(from, flipped);
    const [x2, y2] = center(to, flipped);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const head = width * 2.6;
    const headW = width * 1.6;
    const start = 22; // leave the origin piece visible
    const sx = x1 + ux * start;
    const sy = y1 + uy * start;
    const bx = x2 - ux * head;
    const by = y2 - uy * head;
    const px = -uy;
    const py = ux;
    const w = width / 2;
    const pts = [
      [sx + px * w, sy + py * w], [bx + px * w, by + py * w], [bx + px * headW, by + py * headW],
      [x2, y2],
      [bx - px * headW, by - py * headW], [bx - px * w, by - py * w], [sx - px * w, sy - py * w],
    ];
    return 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
  }

  // arrows: [{ from, to, color, opacity, width, label }]
  // squares: [{ sq, color, opacity }]
  // evalBar: fraction (0..1) of the bar that is White's, or null.
  function draw(board, { arrows = [], squares = [], flipped = false, evalBar = null }) {
    if (!board) return;
    const svg = ensure(board);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (evalBar !== null && evalBar !== undefined) {
      const w = Math.max(0, Math.min(1, evalBar)) * 800;
      svg.appendChild(el('rect', { x: 0, y: 0, width: 12, height: 800, fill: '#262421', 'fill-opacity': 0.85 }));
      svg.appendChild(el('rect', {
        x: 0, y: flipped ? 0 : 800 - w, width: 12, height: w, fill: '#f0f0f0', 'fill-opacity': 0.92,
      }));
      svg.appendChild(el('rect', { x: 0, y: 399, width: 12, height: 2, fill: '#e33', 'fill-opacity': 0.8 }));
    }
    for (const s of squares) {
      const [cx, cy] = center(s.sq, flipped);
      svg.appendChild(el('rect', {
        x: cx - 50, y: cy - 50, width: 100, height: 100,
        fill: s.color, 'fill-opacity': s.opacity,
      }));
    }
    // Draw weaker arrows first so the best one sits on top.
    for (const a of arrows.slice().reverse()) {
      svg.appendChild(el('path', {
        d: arrowPath(a.from, a.to, flipped, a.width || 18),
        fill: a.color, 'fill-opacity': a.opacity, stroke: 'rgba(0,0,0,0.25)', 'stroke-width': 1.5,
      }));
      if (a.label) {
        const [x, y] = center(a.to, flipped);
        const g = el('g', {});
        g.appendChild(el('circle', { cx: x + 30, cy: y - 30, r: 15, fill: a.color, 'fill-opacity': Math.min(1, a.opacity + 0.2) }));
        const t = el('text', {
          x: x + 30, y: y - 25, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700,
          'font-family': 'system-ui, -apple-system, sans-serif', fill: '#fff',
        });
        t.textContent = a.label;
        g.appendChild(t);
        svg.appendChild(g);
      }
    }
  }

  function clear(board) {
    const root = board || document;
    const svg = root.querySelector('#' + ID);
    if (svg) svg.remove();
  }

  return { draw, clear };
})();
