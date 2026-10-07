/**
 * Daily leaderboard in a real browser against a real (local) Worker. Builds the game with
 * the scores URL baked in, starts `wrangler dev` with a throwaway database, and drives the
 * win card's name entry, the board sheet and the failure paths in headless Chromium.
 *   npm run smoke:lb
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ?? path.join(homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux/chrome');
const OUT = process.env.OUT_DIR ?? '/tmp';
const API = 'http://127.0.0.1:8798';
const SITE = 'http://localhost:4189/quack-doku/';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function group(proc) {
  return () => {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
}

console.log('building with the scores URL baked in');
const build = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-lb', '--logLevel', 'warn'], { env: { ...process.env, VITE_SCORES_URL: API }, stdio: 'inherit' });
if (build.status !== 0) process.exit(1);

const db = mkdtempSync(path.join(tmpdir(), 'quack-doku-scores-'));
let worker = spawn('npx', ['wrangler', 'dev', '--local', '--port', '8798', '--config', 'worker/wrangler.toml', '--persist-to', db, '--var', 'ALLOW_LOCALHOST:true'], { stdio: 'ignore', detached: true });
const site = spawn('npx', ['vite', 'preview', '--outDir', 'dist-lb', '--port', '4189', '--strictPort'], { stdio: 'ignore', detached: true });
const stopAll = () => {
  group(worker)();
  group(site)();
  rmSync(db, { recursive: true, force: true });
};
process.on('exit', stopAll);

async function up(url, needle) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.ok && (!needle || (await r.text()).includes(needle))) return;
    } catch {
      /* not yet */
    }
    await wait(500);
  }
  throw new Error(`${url} did not come up`);
}
await up(`${API}/healthz`);
await up(SITE, 'Quack-doku');

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

async function open(opts = {}) {
  // Service workers are blocked so request interception sees every call to the API.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'en-US', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  const posts = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|net::/.test(m.text())) errors.push(m.text());
  });
  page.on('request', (r) => {
    if (r.url().startsWith(API) && r.method() === 'POST') posts.push(r.postDataJSON());
  });
  await page.goto(SITE + (opts.query ?? '?test#/'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game);
  return { ctx, page, errors, posts };
}

async function solveDaily(page, withHint = false) {
  await page.goto(SITE + '?test#/daily');
  await page.waitForFunction(() => window.__game.state()?.n >= 7, null, { timeout: 15000 });
  await page.click('#startBtn');
  if (withHint) {
    await page.click('#hintBtn');
    await page.click('#hintClose');
  }
  await page.waitForTimeout(2600);
  for (const cell of await page.evaluate(() => window.__game.solution())) {
    const c = await page.evaluate((i) => window.__game.cellCenter(i), cell);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(70);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(110);
  }
  await page.waitForFunction(() => window.__game.state().sheet === 'win', null, { timeout: 8000 });
  await page.waitForTimeout(300);
}

{
  console.log('submitting today’s time');
  const { ctx, page, errors, posts } = await open();
  check('leaderboard is on in this build', (await page.evaluate(() => window.__game.leaderboard.enabled)) === true);
  check('home has a leaderboard button', (await page.locator('#lbBtn').count()) === 1);
  await solveDaily(page);
  check('win card offers the name field', await page.isVisible('#nameInput'));
  check('send is disabled until a name is typed', await page.isDisabled('#submitBtn'));
  await page.fill('#nameInput', '  Quacky 🦆 ');
  await page.click('#submitBtn');
  await page.waitForSelector('.submit-status.ok', { timeout: 8000 });
  check('saved with a rank', /#1/.test(await page.textContent('.submit-status.ok')));
  check('own row is highlighted', (await page.locator('.lb-row.me').count()) === 1);
  check('exactly one POST', posts.length === 1, String(posts.length));
  const body = posts[0] ?? {};
  check('the solve carries the answer and a time', typeof body.cols === 'string' && body.cols.length >= 7 && body.ms >= 2500, JSON.stringify(body));
  await page.screenshot({ path: `${OUT}/qd-lb-win.png` });
  await page.goto(SITE + '?test&r=1#/');
  await page.click('#lbBtn');
  await page.waitForSelector('.lb-row', { timeout: 8000 });
  check('board sheet lists the entry', /Quacky/.test(await page.textContent('.lb-list')));
  await page.click('#tabYesterday');
  await page.waitForSelector('.lb-note', { timeout: 8000 });
  check('yesterday tab loads', /No times yet/.test(await page.textContent('.lb-body')));
  await page.screenshot({ path: `${OUT}/qd-lb-board.png` });
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

{
  console.log('a solve with hints');
  const { ctx, page, posts } = await open();
  await solveDaily(page, true);
  check('no name field after using a hint', (await page.locator('#nameInput').count()) === 0);
  check('the card says why', /hints don’t go on the leaderboard/.test(await page.textContent('.win-lb')));
  check('nothing was posted', posts.length === 0);
  await ctx.close();
}

{
  console.log('worker down');
  group(worker)();
  await wait(1500);
  const { ctx, page } = await open();
  await solveDaily(page);
  await page.fill('#nameInput', 'Offline');
  await page.click('#submitBtn');
  await page.waitForSelector('.submit-status.bad', { timeout: 15000 });
  check('a network failure is explained', /Couldn’t reach/.test(await page.textContent('.submit-status.bad')));
  check('and can be retried', (await page.textContent('#submitBtn')) === 'Retry');
  await ctx.close();
}

await browser.close();
console.log(`${checks - failures}/${checks} checks passed; screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
