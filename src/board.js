// ---------------------------------------------------------------------------
// board.js — finds the Chess.com board and reads its position as FEN.
//
// Two strategies:
//  1. Chess.com's board element exposes a `game` object with getFEN().
//     This is exact (castling, en passant, side to move) when available.
//  2. Fallback: read the piece elements ("piece wp square-52") from the DOM
//     and reconstruct the rest of the FEN from the last-move highlight and
//     the history of positions we have seen.
// ---------------------------------------------------------------------------
const BoardReader = (() => {
  const BOARD_SELECTOR = 'wc-chess-board, chess-board';
  const PIECE_RE = /(?:^|\s)([wb])([pnbrqk])(?:\s|$)/;
  const SQUARE_RE = /(?:^|\s)square-(\d)(\d)(?:\s|$)/;

  // Castling rights lost so far in the current game (DOM strategy only).
  let lostCastling = new Set();

  function findBoard() {
    const boards = Array.from(document.querySelectorAll(BOARD_SELECTOR));
    // Prefer the largest visible board (puzzles/sidebars may contain small ones).
    let best = null;
    let bestArea = 0;
    for (const el of boards) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best;
  }

  function squareOf(el) {
    const m = SQUARE_RE.exec(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className);
    if (!m) return -1;
    const file = Number(m[1]) - 1;
    const rank = Number(m[2]) - 1;
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
    return rank * 8 + file;
  }

  function gameApi(board) {
    try {
      const g = board && board.game;
      if (g && typeof g.getFEN === 'function') return g;
    } catch (e) { /* ignore */ }
    return null;
  }

  function isFlipped(board) {
    if (!board) return false;
    if (board.classList.contains('flipped')) return true;
    const g = gameApi(board);
    try {
      const opts = g && typeof g.getOptions === 'function' ? g.getOptions() : null;
      if (opts && typeof opts.flipped === 'boolean') return opts.flipped;
    } catch (e) { /* ignore */ }
    return false;
  }

  // Which colour the user is playing: 'w', 'b' or null when unknown.
  function playingAs(board) {
    const g = gameApi(board);
    try {
      if (g && typeof g.getPlayingAs === 'function') {
        const v = g.getPlayingAs();
        if (v === 1 || v === 'white' || v === 'w') return 'w';
        if (v === 2 || v === 'black' || v === 'b') return 'b';
      }
    } catch (e) { /* ignore */ }
    // The user's pieces are at the bottom of the board.
    return board ? (isFlipped(board) ? 'b' : 'w') : null;
  }

  function readPieces(board) {
    const placement = new Array(64).fill(null);
    for (const el of board.querySelectorAll('.piece')) {
      if (el.closest('.promotion-window, .promotion-area')) continue;
      const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
      const pm = PIECE_RE.exec(cls);
      const sq = squareOf(el);
      if (!pm || sq < 0) continue;
      placement[sq] = pm[1] === 'w' ? pm[2].toUpperCase() : pm[2];
    }
    return placement;
  }

  function highlightedSquares(board) {
    const out = [];
    for (const el of board.querySelectorAll('.highlight')) {
      const sq = squareOf(el);
      if (sq >= 0 && !out.includes(sq)) out.push(sq);
    }
    return out;
  }

  function fenFromDom(board) {
    const b = readPieces(board);
    const placement = Chess.placement(b);
    if (placement === Chess.placement(Chess.parseFen(Chess.START_FEN).board)) lostCastling = new Set();

    // Side to move: the piece standing on a highlighted (last-move) square
    // just moved, so the other side is to move.
    let turn = 'w';
    let lastFrom = -1;
    let lastTo = -1;
    const hl = highlightedSquares(board);
    if (hl.length >= 2) {
      const occupied = hl.filter((sq) => b[sq]);
      const empty = hl.filter((sq) => !b[sq]);
      if (occupied.length === 1) {
        lastTo = occupied[0];
        lastFrom = empty[0];
        turn = Chess.other(Chess.colorOf(b[lastTo]));
      } else if (occupied.length >= 2) {
        // Castling highlights king + rook squares; use the king.
        const king = occupied.find((sq) => Chess.typeOf(b[sq]) === 'k');
        if (king !== undefined) turn = Chess.other(Chess.colorOf(b[king]));
      }
    } else if (placement !== Chess.placement(Chess.parseFen(Chess.START_FEN).board)) {
      // No highlight: guess from the user's side (it is usually our turn when
      // the position is static and nothing is highlighted).
      turn = playingAs(board) || 'w';
    }

    // Castling rights: a right survives while king and rook are on their
    // home squares and have never been seen elsewhere during this game.
    const homes = { K: [4, 7, 'K', 'R'], Q: [4, 0, 'K', 'R'], k: [60, 63, 'k', 'r'], q: [60, 56, 'k', 'r'] };
    let castling = '';
    for (const right of 'KQkq') {
      const [ks, rs, kp, rp] = homes[right];
      if (b[ks] !== kp || b[rs] !== rp) lostCastling.add(right);
      if (!lostCastling.has(right)) castling += right;
    }

    // En passant: last move was a pawn double step.
    let ep = '-';
    if (lastTo >= 0 && lastFrom >= 0 && Chess.typeOf(b[lastTo]) === 'p' && Math.abs(lastTo - lastFrom) === 16) {
      ep = Chess.sqName((lastFrom + lastTo) / 2);
    }
    return [placement, turn, castling || '-', ep, 0, 1].join(' ');
  }

  // Returns { board, fen, source, flipped, playingAs } or null.
  function read() {
    const board = findBoard();
    if (!board) return null;
    let fen = null;
    let source = 'dom';
    const g = gameApi(board);
    if (g) {
      try {
        const f = g.getFEN();
        if (typeof f === 'string' && f.split('/').length === 8) { fen = f; source = 'api'; }
      } catch (e) { /* ignore */ }
    }
    if (!fen) fen = fenFromDom(board);
    // Validate; fall back to DOM if the API result is unusable.
    let pos = null;
    try { pos = Chess.parseFen(fen); } catch (e) { pos = null; }
    if ((!pos || !Chess.isPlausible(pos)) && source === 'api') {
      fen = fenFromDom(board);
      source = 'dom';
      try { pos = Chess.parseFen(fen); } catch (e) { pos = null; }
    }
    if (!pos || !Chess.isPlausible(pos)) return { board, fen: null, source, flipped: isFlipped(board), playingAs: playingAs(board) };
    return { board, fen: Chess.toFen(pos), source, flipped: isFlipped(board), playingAs: playingAs(board) };
  }

  function isGameOver(board) {
    const g = gameApi(board);
    try { if (g && typeof g.isGameOver === 'function') return !!g.isGameOver(); } catch (e) { /* ignore */ }
    return !!document.querySelector('.game-over-modal-content, .game-result-component');
  }

  return { BOARD_SELECTOR, findBoard, read, isFlipped, playingAs, isGameOver, _fenFromDom: fenFromDom };
})();
