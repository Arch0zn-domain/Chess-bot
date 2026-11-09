// Cross-checks src/chess.js against the chess.js reference implementation.
const test = require('node:test');
const assert = require('node:assert');
const Ours = require('../src/chess.js');
const { Chess: Ref } = require('chess.js');

function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of Ours.legalMoves(pos)) n += perft(Ours.applyMove(pos, m), depth - 1);
  return n;
}

test('perft matches known values', () => {
  assert.strictEqual(perft(Ours.parseFen(Ours.START_FEN), 3), 8902);
  // "Kiwipete" — castling, en passant, promotions, pins
  const kiwi = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  assert.strictEqual(perft(Ours.parseFen(kiwi), 2), 2039);
  assert.strictEqual(perft(Ours.parseFen(kiwi), 3), 97862);
  // Position 3 (en passant / discovered checks)
  assert.strictEqual(perft(Ours.parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 4), 43238);
});

test('SAN and FEN match chess.js over random games', () => {
  let seed = 12345;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let game = 0; game < 25; game++) {
    const ref = new Ref();
    let pos = Ours.parseFen(Ours.START_FEN);
    for (let ply = 0; ply < 200 && !ref.isGameOver(); ply++) {
      const refMoves = ref.moves({ verbose: true });
      const ourLegal = Ours.legalMoves(pos);
      assert.strictEqual(ourLegal.length, refMoves.length, ref.fen());
      const mv = refMoves[rand(refMoves.length)];
      const uci = mv.from + mv.to + (mv.promotion || '');
      const ours = Ours.findUci(pos, uci, ourLegal);
      assert.ok(ours, 'missing move ' + uci + ' in ' + ref.fen());
      assert.strictEqual(Ours.san(pos, ours, ourLegal), mv.san, ref.fen());
      ref.move(mv);
      pos = Ours.applyMove(pos, ours);
      // chess.js only writes an ep square when a capture is possible; compare the rest.
      const strip = (f) => f.split(' ').filter((_, i) => i !== 3).join(' ');
      assert.strictEqual(strip(Ours.toFen(pos)), strip(ref.fen()));
    }
  }
});

test('pvToSan formats lines', () => {
  const line = Ours.pvToSan(Ours.START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'zzzz', 'f1b5']);
  assert.strictEqual(Ours.formatLine(line), '1. e4 e5 2. Nf3 Nc6');
  const black = Ours.pvToSan('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', ['c7c5', 'g1f3']);
  assert.strictEqual(Ours.formatLine(black), '1... c5 2. Nf3');
  assert.strictEqual(Ours.gameStatus(Ours.parseFen('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')), 'checkmate');
  assert.strictEqual(Ours.gameStatus(Ours.parseFen('7k/8/6QK/8/8/8/8/8 b - - 0 1')), 'stalemate');
});
