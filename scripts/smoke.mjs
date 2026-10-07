/**
 * Headless smoke test + screenshots. Uses the Playwright Chromium already cached on this
 * machine. Set BASE_URL to test a deployed site instead of a local preview build.
 *   npm run build && npm run smoke
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ?? path.join(homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux/chrome');
const OUT = process.env.OUT_DIR ?? '/tmp';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

let server = null;
let base = process.env.BASE_URL;
if (!base) {
  if (!existsSync('dist')) throw new Error('run npm run build first');
  // Own port, and proof that the page served is this game: other projects' previews run on this machine too.
  const port = process.env.PORT ?? '4187';
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: 'ignore', detached: true });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  });
  base = `http://localhost:${port}/quack-doku/`;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (server.exitCode !== null) throw new Error(`vite preview exited (is port ${port} in use?)`);
    try {
      const r = await fetch(base);
      up = r.ok && (await r.text()).includes('Quack-doku');
    } catch {
      /* not yet */
    }
  }
  if (!up) throw new Error(`preview server did not come up on port ${port}`);
}
if (!base.endsWith('/')) base += '/';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
let checks = 0;
let failures = 0;
function check(name, cond, detail = '') {
  checks++;
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: opts.dpr ?? 1,
    hasTouch: !!opts.touch,
    isMobile: !!opts.touch,
    locale: opts.locale ?? 'en-US',
    colorScheme: opts.dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text());
  });
  await page.goto(base + (opts.query ?? '?test'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  return { ctx, page, errors };
}

const state = (page) => page.evaluate(() => window.__game.state());
const waitBoard = (page, n) => page.waitForFunction((n) => window.__game.state()?.n === n && !window.__game.state().solved, n, { timeout: 15000 });
const center = (page, i) => page.evaluate((i) => window.__game.cellCenter(i), i);

/** Peak level on the master bus while `act` runs. */
async function soundPeak(page, act) {
  await page.evaluate(() => {
    const { audio } = window.__game;
    audio.unlock();
    const an = audio.ctx.createAnalyser();
    an.fftSize = 2048;
    audio.master.connect(an);
    window.__peak = 0;
    const buf = new Float32Array(an.fftSize);
    window.__peakTimer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) window.__peak = Math.max(window.__peak, Math.abs(v));
    }, 20);
  });
  await act();
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    clearInterval(window.__peakTimer);
    return { peak: window.__peak, state: window.__game.audio.ctx.state };
  });
}

async function doubleTapTouch(page, i) {
  const c = await center(page, i);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(70);
  await page.touchscreen.tap(c.x, c.y);
}

async function solveByTouch(page) {
  for (const cell of await page.evaluate(() => window.__game.solution())) {
    await doubleTapTouch(page, cell);
    await page.waitForTimeout(120);
  }
}

async function solveByMouse(page) {
  for (const cell of await page.evaluate(() => window.__game.solution())) {
    const c = await center(page, cell);
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await page.waitForTimeout(40);
  }
}

// ---- 1. Desktop: home, mouse play, sound, undo, reset ----
{
  console.log('desktop');
  const { ctx, page, errors } = await open({ width: 1280, height: 860 });
  check('home shows the logo', (await page.textContent('.logo')) === 'Quack-doku');
  check('daily card is there', await page.isVisible('#dailyCard'));
  const lb = await page.evaluate(() => window.__game.leaderboard);
  check('leaderboard button matches the build', (await page.locator('#lbBtn').count()) === (lb.enabled ? 1 : 0), JSON.stringify(lb));
  await page.screenshot({ path: `${OUT}/qd-desktop-home.png` });
  await page.click('#playBtn');
  await waitBoard(page, 5);
  check('level 1 opens with 25 cells', (await page.locator('.cell').count()) === 25);
  check('coach mark explains the double-tap', /Double-tap/.test(await page.textContent('#status')));
  let c = await center(page, 0);
  await page.mouse.click(c.x, c.y);
  check('click marks an X', (await state(page)).marks[0] === 'x');
  await page.waitForTimeout(400);
  await page.mouse.click(c.x, c.y);
  check('second (slow) click clears it', (await state(page)).marks[0] === '.');
  await page.waitForTimeout(400);
  const snd = await soundPeak(page, async () => {
    await page.mouse.click(c.x, c.y);
    await page.mouse.click(c.x, c.y);
  });
  check('double click places a duck', (await state(page)).marks[0] === 'D');
  check('the duck quacks (audio running with signal)', snd.state === 'running' && snd.peak > 0.01, JSON.stringify(snd));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  check('right click removes the duck', (await state(page)).marks[0] === '.');
  // Drag along row 4.
  const a = await center(page, 20);
  const z = await center(page, 23);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(a.x + ((z.x - a.x) * k) / 6, a.y);
  await page.mouse.up();
  check('drag crosses four cells', (await state(page)).marks.slice(20) === 'xxxx.', (await state(page)).marks);
  await page.click('#undoBtn');
  check('undo takes the whole drag back', (await state(page)).marks === '.'.repeat(25));
  await page.mouse.click(c.x, c.y);
  await page.click('#resetBtn');
  await page.click('#resetYes');
  check('reset clears the board', (await state(page)).marks === '.'.repeat(25));
  // Keyboard.
  await page.focus('.board');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  check('keyboard places a duck', (await state(page)).marks[2] === 'D');
  check('cell label says duck', /duck/.test((await page.getAttribute('.cell[data-cell="2"]', 'aria-label')) ?? ''));
  await page.keyboard.press('z');
  // Solve with the mouse and win.
  await solveByMouse(page);
  await page.waitForFunction(() => window.__game.state().sheet === 'win', null, { timeout: 5000 });
  check('win card appears', await page.isVisible('.sheet-win'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/qd-desktop-win.png` });
  check('progress is saved', await page.evaluate(() => window.__game.progress.isSolved(1)));
  await page.click('#nextBtn');
  await waitBoard(page, 5);
  check('next level opens', (await state(page)).kind.k === 2);
  check('no console errors (desktop)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- 2. Phone: touch, hints, daily ----
{
  console.log('phone');
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, { touch: true, dpr: 3 });
  await page.goto(base + '?test#/level/3');
  await waitBoard(page, 5);
  const sol = await page.evaluate(() => window.__game.solution());
  let c = await center(page, sol[0]);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(400);
  check('tap marks an X', (await state(page)).marks[sol[0]] === 'x');
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(400);
  await doubleTapTouch(page, sol[0]);
  await page.waitForTimeout(200);
  check('double-tap places a duck', (await state(page)).marks[sol[0]] === 'D');
  check('double-tap does not zoom', (await page.evaluate(() => visualViewport.scale)) === 1);
  // Swipe with raw touch events across the last row.
  const a = await center(page, 20);
  const z = await center(page, 24);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((z.x - a.x) * k) / 8, y: a.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  check('swipe crosses the row', (await state(page)).marks.slice(20) === 'xxxxx', (await state(page)).marks);
  // That swipe crossed the true duck cell of row 4: the hint says so first.
  await page.click('#hintBtn');
  await page.waitForTimeout(200);
  check('hint reports the mistake', /can’t be right/.test(await page.textContent('#hintText')));
  await page.click('#hintShow');
  await page.waitForTimeout(200);
  check('show me points at it', (await page.locator('.cell.hl-wrong').count()) === 1);
  const box = await page.locator('.board').boundingBox();
  const panel = await page.locator('#hintPanel').boundingBox();
  check('hint panel leaves the board visible', box && panel && panel.y >= box.y + box.height - 1, JSON.stringify({ box, panel }));
  await page.screenshot({ path: `${OUT}/qd-phone-hint.png` });
  await page.click('#hintShow');
  await page.click('#hintBtn');
  await page.waitForTimeout(200);
  const hintText = await page.textContent('#hintText');
  check('a real deduction follows', hintText.length > 20 && !/can’t be right/.test(hintText), hintText);
  check('it highlights cells', (await page.locator('.cell.hl-focus').count()) > 0);
  const before = (await state(page)).marks;
  await page.click('#hintShow');
  check('show me applies it', (await state(page)).marks !== before);

  // Daily: Start overlay, solve, streak, reload.
  await page.goto(base + '?test#/daily');
  await page.waitForFunction(() => window.__game.state()?.n >= 7, null, { timeout: 15000 });
  check('daily waits behind a Start button', await page.isVisible('#startBtn'));
  await page.screenshot({ path: `${OUT}/qd-phone-daily-start.png` });
  await page.click('#startBtn');
  await solveByTouch(page);
  await page.waitForFunction(() => window.__game.state().sheet === 'win', null, { timeout: 8000 });
  check('daily win card has a share button', await page.isVisible('#shareBtn'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/qd-phone-daily-win.png` });
  await page.goto(base + '?test&r=2#/');
  await page.waitForSelector('#dailyCard');
  check('home shows today solved', /Solved in/.test(await page.textContent('#dailyCard')));
  check('streak is 1', (await page.textContent('#dailyCard .streak')).trim() === '1');
  await page.screenshot({ path: `${OUT}/qd-phone-home.png` });
  check('no console errors (phone)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- 3. Levels, languages, dark mode, offline ----
{
  console.log('levels and languages');
  const { ctx, page, errors } = await open({ width: 412, height: 915 }, { touch: true, dpr: 2 });
  await page.goto(base + '?test#/levels');
  await page.waitForSelector('.lvl');
  check('400 level buttons', (await page.locator('.lvl').count()) === 400);
  check('only three open on a fresh device', (await page.locator('.lvl.locked').count()) === 397);
  await page.screenshot({ path: `${OUT}/qd-levels.png` });
  for (const [lang, text] of [
    ['zh-CN', '鸭鸭数独'],
    ['zh-TW', '鴨鴨數獨'],
    ['es', 'Pato del Día'],
  ]) {
    await page.goto(base + `?lang=${lang}&test#/`);
    await page.waitForSelector('#dailyCard');
    const body = await page.textContent('body');
    check(`${lang} renders`, body.includes(text));
  }
  await page.goto(base + '?lang=es&test#/level/1');
  await waitBoard(page, 5);
  await page.click('#hintBtn');
  check('hint text is translated', /región|fila|columna/.test(await page.textContent('#hintText')));
  if (!process.env.BASE_URL || process.env.CHECK_SW) {
    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
      return reg ? 'ready' : 'timeout';
    });
    check('service worker registers', sw === 'ready', sw);
  }
  check('no console errors (levels)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  const dark = await open({ width: 390, height: 844 }, { touch: true, dpr: 2, dark: true, locale: 'zh-CN', query: '?test#/level/1' });
  await waitBoard(dark.page, 5);
  await dark.page.waitForTimeout(300);
  await dark.page.screenshot({ path: `${OUT}/qd-dark-zh.png` });
  check('no console errors (dark)', dark.errors.length === 0, dark.errors.join(' | '));
  await dark.ctx.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed; screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
