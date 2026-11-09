// ---------------------------------------------------------------------------
// chess.js — minimal chess rules: FEN parsing, legal move generation,
// UCI -> SAN conversion. Squares are 0..63 with a1 = 0, h1 = 7, a8 = 56.
// ---------------------------------------------------------------------------
const Chess = (() => {
  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  const fileOf = (sq) => sq & 7;
  const rankOf = (sq) => sq >> 3;
  const sqName = (sq) => FILES[fileOf(sq)] + (rankOf(sq) + 1);
  const sqIndex = (name) => {
    if (!name || name.length !== 2) return -1;
    const f = FILES.indexOf(name[0]);
    const r = Number(name[1]) - 1;
    return f < 0 || !(r >= 0 && r < 8) ? -1 : r * 8 + f;
  };
  const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);
  const typeOf = (p) => (p ? p.toLowerCase() : null);
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

  function parseFen(fen) {
    const parts = String(fen || '').trim().split(/\s+/);
    const rows = (parts[0] || '').split('/');
    if (rows.length !== 8) throw new Error('Bad FEN: ' + fen);
    const board = new Array(64).fill(null);
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (/[1-8]/.test(ch)) file += Number(ch);
        else if (/[pnbrqkPNBRQK]/.test(ch)) {
          if (file > 7) throw new Error('Bad FEN: ' + fen);
          board[rank * 8 + file++] = ch;
        } else throw new Error('Bad FEN: ' + fen);
      }
      if (file !== 8) throw new Error('Bad FEN: ' + fen);
    }
    return {
      board,
      turn: parts[1] === 'b' ? 'b' : 'w',
      castling: parts[2] && parts[2] !== '-' ? parts[2] : '',
      ep: parts[3] && parts[3] !== '-' ? sqIndex(parts[3]) : -1,
      half: Number(parts[4]) || 0,
      full: Number(parts[5]) || 1,
    };
  }

  function placement(board) {
    const rows = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = board[rank * 8 + file];
        if (!p) empty++;
        else {
          if (empty) row += empty;
          empty = 0;
          row += p;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }

  function toFen(pos) {
    return [
      placement(pos.board),
      pos.turn,
      pos.castling || '-',
      pos.ep >= 0 ? sqName(pos.ep) : '-',
      pos.half,
      pos.full,
    ].join(' ');
  }

  function findKing(pos, color) {
    const k = color === 'w' ? 'K' : 'k';
    return pos.board.indexOf(k);
  }

  // Is `sq` attacked by any piece of colour `by`?
  function attacked(pos, sq, by) {
    const b = pos.board;
    const f = fileOf(sq);
    const r = rankOf(sq);
    const is = (ff, rr, types) => {
      if (!onBoard(ff, rr)) return false;
      const p = b[rr * 8 + ff];
      return !!p && colorOf(p) === by && types.includes(typeOf(p));
    };
    // Pawns
    const pr = by === 'w' ? r - 1 : r + 1;
    if (is(f - 1, pr, 'p') || is(f + 1, pr, 'p')) return true;
    for (const [df, dr] of KNIGHT) if (is(f + df, r + dr, 'n')) return true;
    for (const [df, dr] of KING) if (is(f + df, r + dr, 'k')) return true;
    const slide = (dirs, types) => {
      for (const [df, dr] of dirs) {
        let ff = f + df;
        let rr = r + dr;
        while (onBoard(ff, rr)) {
          const p = b[rr * 8 + ff];
          if (p) {
            if (colorOf(p) === by && types.includes(typeOf(p))) return true;
            break;
          }
          ff += df;
          rr += dr;
        }
      }
      return false;
    };
    return slide(ROOK_DIRS, 'rq') || slide(BISHOP_DIRS, 'bq');
  }

  function inCheck(pos, color = pos.turn) {
    const k = findKing(pos, color);
    return k >= 0 && attacked(pos, k, other(color));
  }

  function pseudoMoves(pos) {
    const moves = [];
    const b = pos.board;
    const us = pos.turn;
    const them = other(us);
    const add = (from, to, extra) => moves.push(Object.assign({ from, to }, extra));

    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || colorOf(p) !== us) continue;
      const f = fileOf(sq);
      const r = rankOf(sq);
      const t = typeOf(p);

      if (t === 'p') {
        const dir = us === 'w' ? 1 : -1;
        const startRank = us === 'w' ? 1 : 6;
        const promoRank = us === 'w' ? 7 : 0;
        const pushPawn = (to, extra) => {
          if (rankOf(to) === promoRank) {
            for (const promo of 'qrbn') add(sq, to, Object.assign({ promo }, extra));
          } else add(sq, to, extra);
        };
        const one = sq + dir * 8;
        if (onBoard(f, r + dir) && !b[one]) {
          pushPawn(one);
          const two = sq + dir * 16;
          if (r === startRank && !b[two]) add(sq, two, { double: true });
        }
        for (const df of [-1, 1]) {
          if (!onBoard(f + df, r + dir)) continue;
          const to = (r + dir) * 8 + f + df;
          if (b[to] && colorOf(b[to]) === them) pushPawn(to, { capture: true });
          else if (to === pos.ep) add(sq, to, { capture: true, enPassant: true });
        }
      } else if (t === 'n' || t === 'k') {
        for (const [df, dr] of t === 'n' ? KNIGHT : KING) {
          if (!onBoard(f + df, r + dr)) continue;
          const to = (r + dr) * 8 + f + df;
          if (!b[to]) add(sq, to);
          else if (colorOf(b[to]) === them) add(sq, to, { capture: true });
        }
        if (t === 'k') addCastling(pos, sq, add);
      } else {
        const dirs = t === 'r' ? ROOK_DIRS : t === 'b' ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
        for (const [df, dr] of dirs) {
          let ff = f + df;
          let rr = r + dr;
          while (onBoard(ff, rr)) {
            const to = rr * 8 + ff;
            if (!b[to]) add(sq, to);
            else {
              if (colorOf(b[to]) === them) add(sq, to, { capture: true });
              break;
            }
            ff += df;
            rr += dr;
          }
        }
      }
    }
    return moves;
  }

  function addCastling(pos, kingSq, add) {
    const us = pos.turn;
    const them = other(us);
    const home = us === 'w' ? 4 : 60;
    if (kingSq !== home || attacked(pos, home, them)) return;
    const b = pos.board;
    const rook = us === 'w' ? 'R' : 'r';
    const rights = us === 'w' ? ['K', 'Q'] : ['k', 'q'];
    if (pos.castling.includes(rights[0]) && b[home + 3] === rook && !b[home + 1] && !b[home + 2] &&
        !attacked(pos, home + 1, them) && !attacked(pos, home + 2, them)) {
      add(home, home + 2, { castle: 'k' });
    }
    if (pos.castling.includes(rights[1]) && b[home - 4] === rook && !b[home - 1] && !b[home - 2] &&
        !b[home - 3] && !attacked(pos, home - 1, them) && !attacked(pos, home - 2, them)) {
      add(home, home - 2, { castle: 'q' });
    }
  }

  function applyMove(pos, m) {
    const b = pos.board.slice();
    const p = b[m.from];
    const us = pos.turn;
    const captured = m.enPassant ? b[m.to + (us === 'w' ? -8 : 8)] : b[m.to];
    b[m.to] = m.promo ? (us === 'w' ? m.promo.toUpperCase() : m.promo) : p;
    b[m.from] = null;
    if (m.enPassant) b[m.to + (us === 'w' ? -8 : 8)] = null;
    if (m.castle) {
      const home = us === 'w' ? 4 : 60;
      const [rf, rt] = m.castle === 'k' ? [home + 3, home + 1] : [home - 4, home - 1];
      b[rt] = b[rf];
      b[rf] = null;
    }
    let castling = pos.castling;
    const strip = (chars) => { for (const c of chars) castling = castling.replace(c, ''); };
    if (p === 'K') strip('KQ');
    if (p === 'k') strip('kq');
    for (const sq of [m.from, m.to]) {
      if (sq === 7) strip('K');
      if (sq === 0) strip('Q');
      if (sq === 63) strip('k');
      if (sq === 56) strip('q');
    }
    return {
      board: b,
      turn: other(us),
      castling,
      ep: m.double ? (m.from + m.to) / 2 : -1,
      half: typeOf(p) === 'p' || captured ? 0 : pos.half + 1,
      full: us === 'b' ? pos.full + 1 : pos.full,
    };
  }

  function legalMoves(pos) {
    return pseudoMoves(pos).filter((m) => !inCheck(applyMove(pos, m), pos.turn));
  }

  function findUci(pos, uci, legal = legalMoves(pos)) {
    if (!uci || uci.length < 4) return null;
    const from = sqIndex(uci.slice(0, 2));
    const to = sqIndex(uci.slice(2, 4));
    const promo = uci[4] ? uci[4].toLowerCase() : undefined;
    return legal.find((m) => m.from === from && m.to === to && (m.promo || undefined) === promo) || null;
  }

  function san(pos, m, legal = legalMoves(pos)) {
    let s;
    const p = pos.board[m.from];
    const t = typeOf(p);
    if (m.castle) s = m.castle === 'k' ? 'O-O' : 'O-O-O';
    else if (t === 'p') {
      s = m.capture ? FILES[fileOf(m.from)] + 'x' + sqName(m.to) : sqName(m.to);
      if (m.promo) s += '=' + m.promo.toUpperCase();
    } else {
      s = t.toUpperCase();
      const rivals = legal.filter((o) => o.to === m.to && o.from !== m.from && pos.board[o.from] === p);
      if (rivals.length) {
        const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
        const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
        if (!sameFile) s += FILES[fileOf(m.from)];
        else if (!sameRank) s += rankOf(m.from) + 1;
        else s += sqName(m.from);
      }
      if (m.capture) s += 'x';
      s += sqName(m.to);
    }
    const next = applyMove(pos, m);
    if (inCheck(next)) s += legalMoves(next).length ? '+' : '#';
    return s;
  }

  // Convert a list of UCI moves into SAN, starting from `fen`. Stops at the
  // first move that is not legal (e.g. stale engine output).
  function pvToSan(fen, uciMoves, limit = 99) {
    const out = [];
    let pos;
    try { pos = parseFen(fen); } catch (e) { return out; }
    for (const uci of uciMoves.slice(0, limit)) {
      const legal = legalMoves(pos);
      const m = findUci(pos, uci, legal);
      if (!m) break;
      out.push({ san: san(pos, m, legal), color: pos.turn, moveNo: pos.full, uci });
      pos = applyMove(pos, m);
    }
    return out;
  }

  // Format a SAN line as "12. Nf3 Nc6 13. Bb5" / "12... Nc6 13. Bb5".
  function formatLine(moves) {
    return moves
      .map((mv, i) => {
        if (mv.color === 'w') return mv.moveNo + '. ' + mv.san;
        return i === 0 ? mv.moveNo + '... ' + mv.san : mv.san;
      })
      .join(' ');
  }

  // Basic sanity check: one king each, no pawns on the back ranks and the
  // side that just moved is not in check.
  function isPlausible(pos) {
    const b = pos.board;
    if (b.filter((p) => p === 'K').length !== 1 || b.filter((p) => p === 'k').length !== 1) return false;
    for (let f = 0; f < 8; f++) {
      if (typeOf(b[f]) === 'p' || typeOf(b[56 + f]) === 'p') return false;
    }
    return !inCheck(pos, other(pos.turn));
  }

  function gameStatus(pos) {
    const legal = legalMoves(pos);
    if (legal.length) return null;
    return inCheck(pos) ? 'checkmate' : 'stalemate';
  }

  return {
    START_FEN, FILES, sqName, sqIndex, fileOf, rankOf, colorOf, typeOf, other,
    parseFen, toFen, placement, attacked, inCheck, legalMoves, applyMove,
    findUci, san, pvToSan, formatLine, isPlausible, gameStatus,
  };
})();

if (typeof module === 'object' && module && module.exports) module.exports = Chess; // @node-only
