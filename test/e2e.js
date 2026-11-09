#!/usr/bin/env node
// End-to-end check: serves the mock Chess.com page, injects the built
// userscript, runs the real Stockfish WASM engine and verifies the panel,
// arrows, DOM-only FEN reading, flipped boards, page gating and the iPhone
// (docked) layout. Screenshots go to test/screenshots/.
//
//   npm run build && node test/e2e.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');

const root = path.join(__dirname, '..');
const shots = path.join(__dirname, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const userscript = fs.readFileSync(path.join(root, 'dist', 'stockfish-overlay.user.js'), 'utf8');
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file;
  if (/^\/(play\/computer|play\/online|analysis)/.test(url.pathname)) file = path.join(__dirname, 'mock', 'play-computer.html');
  else if (url.pathname.startsWith('/engine/')) file = path.join(root, 'node_modules', 'stockfish', 'bin', path.basename(url.pathname));
  else if (url.pathname.startsWith('/node_modules/')) file = path.join(root, url.pathname);
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(file).pipe(res);
});

async function openPage(browser, base, route, ctxOpts = {}, settings = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((s) => {
    localStorage.setItem('sfo-settings-v1', JSON.stringify(s));
  }, Object.assign({ engineUrl: base + '/engine/stockfish-19-lite-single.js', depth: 12 }, settings));
  await page.goto(base + route);
  await page.waitForSelector('wc-chess-board .piece');
  await page.addScriptTag({ content: userscript });
  return { ctx, page, errors };
}

const panelText = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector('#sfo-root').shadowRoot.querySelector(s);
  return el ? el.textContent : null;
}, sel);

// Waits until the panel shows a finished search for the mock's current position.
async function waitForAnalysis(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const r = document.querySelector('#sfo-root');
    const sr = r && r.shadowRoot;
    const stats = sr && sr.querySelector('.stats');
    const strip = (f) => f.split(' ').slice(0, 2).join(' ');
    return stats && /done/.test(stats.textContent) && strip(r.dataset.fen || '') === strip(window.mock.fen());
  }, null, { timeout });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  let failures = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log('PASS', name); } catch (e) { failures++; console.log('FAIL', name, '\n  ', e.message); }
  };

  await check('desktop: engine loads, analyses, draws arrows', async () => {
    const { ctx, page, errors } = await openPage(browser, base, '/play/computer', { viewport: { width: 1280, height: 800 } });
    await waitForAnalysis(page);
    const best = await panelText(page, '.best .move');
    assert.ok(/^[a-hNBRQKO]/.test(best), 'best move shown: ' + best);
    const evalTxt = await panelText(page, '.eval');
    assert.ok(/^[+−-]?\d|^[-]?M/.test(evalTxt), 'eval shown: ' + evalTxt);
    const lines = await page.evaluate(() => document.querySelector('#sfo-root').shadowRoot.querySelectorAll('.lines li').length);
    assert.strictEqual(lines, 3, 'three candidate lines');
    const arrows = await page.locator('#sfo-board-overlay path').count();
    assert.strictEqual(arrows, 3, 'three arrows');
    await page.screenshot({ path: path.join(shots, 'desktop-start.png') });

    // Play the engine's move and wait for the bot reply + new analysis.
    const fenBefore = await page.evaluate(() => window.mock.fen());
    await page.evaluate(() => window.mock.move('e2e4'));
    await page.waitForFunction((f) => window.mock.fen() !== f && window.mock.fen().split(' ')[1] === 'w', fenBefore);
    await waitForAnalysis(page);
    const stats = await panelText(page, '.stats');
    assert.ok(/board: live/.test(stats), 'used game API: ' + stats);
    await page.screenshot({ path: path.join(shots, 'desktop-after-move.png') });
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  await check('DOM-only FEN reading matches the real position', async () => {
    const { ctx, page, errors } = await openPage(browser, base, '/play/computer?api=0&botDelay=50', { viewport: { width: 1280, height: 800 } });
    await waitForAnalysis(page);
    // Play a few moves (the mock bot answers randomly); skip moves that became illegal.
    for (const uci of ['e2e4', 'g1f3', 'f1c4', 'e1g1']) {
      await page.evaluate((u) => { try { window.mock.move(u); } catch (e) { /* illegal now */ } }, uci);
      await page.waitForFunction(() => window.mock.fen().split(' ')[1] === 'w');
      await page.waitForTimeout(250);
    }
    const real = await page.evaluate(() => window.mock.fen());
    const stats = await panelText(page, '.stats');
    assert.ok(/board: DOM/.test(stats), 'DOM mode: ' + stats);
    // The first PV move must be legal in the real position.
    await waitForAnalysis(page);
    const best = await panelText(page, '.best .move');
    const legal = await page.evaluate(async ({ fen, san }) => {
      const { Chess } = await import('/node_modules/chess.js/dist/esm/chess.js');
      const c = new Chess(fen);
      return c.moves().includes(san);
    }, { fen: real, san: best });
    assert.ok(legal, `best move ${best} legal in ${real}`);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  await check('flipped board (playing Black): arrows map to the right squares', async () => {
    const { ctx, page, errors } = await openPage(browser, base, '/play/computer?flip=1', { viewport: { width: 1280, height: 800 } }, { multiPv: 1, arrowCount: 1 });
    await page.waitForFunction(() => window.mock.fen().split(' ')[1] === 'b');
    await waitForAnalysis(page);
    // Compare arrow tip with the on-screen centre of the destination square.
    const res = await page.evaluate(() => {
      const path = document.querySelector('#sfo-board-overlay path');
      const d = path.getAttribute('d');
      const pts = d.slice(1, -1).split('L').map((p) => p.split(',').map(Number));
      const tip = pts[3];
      const board = document.querySelector('wc-chess-board');
      const r = board.getBoundingClientRect();
      const x = r.left + (tip[0] / 800) * r.width;
      const y = r.top + (tip[1] / 800) * r.height;
      const best = document.querySelector('#sfo-root').shadowRoot.querySelector('.best .move').textContent;
      return { x, y, best, fen: window.mock.fen() };
    });
    const target = await page.evaluate(async ({ fen, san }) => {
      const { Chess } = await import('/node_modules/chess.js/dist/esm/chess.js');
      return new Chess(fen).move(san).to;
    }, { fen: res.fen, san: res.best });
    const sqBox = await page.evaluate((sq) => {
      const board = document.querySelector('wc-chess-board');
      const r = board.getBoundingClientRect();
      const f = 'abcdefgh'.indexOf(sq[0]);
      const rk = Number(sq[1]) - 1;
      // flipped: a-file on the right, rank 1 at the top
      return { x: r.left + (7 - f + 0.5) * r.width / 8, y: r.top + (rk + 0.5) * r.height / 8 };
    }, target);
    assert.ok(Math.abs(sqBox.x - res.x) < 3 && Math.abs(sqBox.y - res.y) < 3, `arrow tip ${JSON.stringify(res)} vs ${target} ${JSON.stringify(sqBox)}`);
    await page.screenshot({ path: path.join(shots, 'desktop-flipped.png') });
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  await check('not active on live games against people', async () => {
    const { ctx, page } = await openPage(browser, base, '/play/online', { viewport: { width: 1280, height: 800 } });
    await page.waitForTimeout(1500);
    const shown = await page.evaluate(() => {
      const r = document.querySelector('#sfo-root');
      return !!r && r.style.display !== 'none';
    });
    assert.strictEqual(shown, false, 'panel hidden');
    assert.strictEqual(await page.locator('#sfo-board-overlay').count(), 0, 'no arrows');
    await ctx.close();
  });

  await check('iPhone: docked layout, settings, collapse', async () => {
    const { ctx, page, errors } = await openPage(browser, base, '/play/computer', Object.assign({}, devices['iPhone 15 Pro'], { defaultBrowserType: undefined }));
    await waitForAnalysis(page);
    const layout = await page.evaluate(() => document.querySelector('#sfo-root').shadowRoot.querySelector('.panel').className);
    assert.ok(/docked/.test(layout), 'docked on phone: ' + layout);
    await page.screenshot({ path: path.join(shots, 'iphone-analysis.png') });
    // Open settings, change number of lines via the slider.
    const sr = page.locator('#sfo-root');
    await sr.locator('button[data-act=settings]').tap();
    await page.screenshot({ path: path.join(shots, 'iphone-settings.png') });
    await sr.locator('input[data-key=multiPv]').fill('1');
    await sr.locator('input[data-key=multiPv]').dispatchEvent('change');
    await sr.locator('button[data-act=settings]').tap();
    await waitForAnalysis(page);
    const lines = await page.evaluate(() => document.querySelector('#sfo-root').shadowRoot.querySelectorAll('.lines li').length);
    assert.strictEqual(lines, 1, 'one line after setting MultiPV=1');
    await sr.locator('button[data-act=collapse]').tap();
    await page.screenshot({ path: path.join(shots, 'iphone-collapsed.png') });
    await sr.locator('button[data-act=hide]').tap();
    await sr.locator('.fab').waitFor({ state: 'visible', timeout: 2000 });
    await sr.locator('.panel').waitFor({ state: 'hidden', timeout: 2000 });
    await page.screenshot({ path: path.join(shots, 'iphone-hidden.png') });
    await sr.locator('.fab').tap();
    await sr.locator('.panel').waitFor({ state: 'visible', timeout: 2000 });
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
