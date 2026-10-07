/**
 * Regenerate icon and preview assets into public/ using headless Chromium and the real game:
 *   - icon.svg / favicon.svg: the rubber duck on bath water (from window.__game.iconSvg)
 *   - icons/icon-192.png, icons/icon-512.png, icons/icon-512-maskable.png, apple-touch-icon.png
 *   - splash/<w>x<h>.png Apple launch screens for every current iPhone/iPad size
 *   - cover.png 1200x630 Open Graph preview rendered from the game
 * Writes the <link rel="apple-touch-startup-image"> tags into index.html.
 *   npm run build && npm run assets && npm run build
 * ONLY=cover regenerates just the cover.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ?? path.join(homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux/chrome');
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const PORT = process.env.PORT ?? '4188';
const BASE = `http://localhost:${PORT}/quack-doku/`;

if (!existsSync('dist')) throw new Error('run npm run build first (assets render from the preview build)');
const server = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stop);
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await fetch(BASE);
    if (r.ok && (await r.text()).includes('Quack-doku')) break;
  } catch {
    /* not yet */
  }
  if (i === 59) throw new Error(`preview did not come up on ${PORT}`);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const font = 'data:font/woff2;base64,' + readFileSync('node_modules/@fontsource/fredoka/files/fredoka-latin-600-normal.woff2').toString('base64');
const fontFace = `@font-face { font-family: 'FredokaArt'; font-weight: 600; src: url(${font}) format('woff2'); }`;
const CJK = "'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Noto Sans SC', 'WenQuanYi Micro Hei', sans-serif";
const logoCss = (size) =>
  `font: 600 ${size}px FredokaArt, system-ui, sans-serif; color: #ffd23f; -webkit-text-stroke: ${Math.max(2, Math.round(size / 22))}px #e48d0b; paint-order: stroke fill; text-shadow: 0 ${Math.round(size / 12)}px 0 rgba(228,141,11,.35);`;

async function gamePage(viewport, query, init) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage();
  await p.goto(BASE + query, { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.__game);
  return { ctx, p };
}

const coverOnly = process.env.ONLY === 'cover';
if (!coverOnly) {
  const { ctx, p } = await gamePage({ width: 400, height: 400 }, '?lang=en');
  const svg = await p.evaluate(() => window.__game.iconSvg(512, false));
  const fav = await p.evaluate(() => window.__game.iconSvg(64, false));
  const masked = await p.evaluate(() => window.__game.iconSvg(512, true));
  await ctx.close();
  writeFileSync('public/icon.svg', svg + '\n');
  writeFileSync('public/favicon.svg', fav + '\n');
  const dataUrl = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
  mkdirSync('public/icons', { recursive: true });
  mkdirSync('public/splash', { recursive: true });

  async function icon(size, file, src) {
    const c = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const page = await c.newPage();
    await page.setContent(`<body style="margin:0"><img src="${dataUrl(src)}" style="display:block;width:${size}px;height:${size}px"></body>`);
    await page.waitForTimeout(100);
    await page.screenshot({ path: file });
    await c.close();
  }
  await icon(180, 'public/apple-touch-icon.png', svg);
  await icon(192, 'public/icons/icon-192.png', svg);
  await icon(512, 'public/icons/icon-512.png', svg);
  await icon(512, 'public/icons/icon-512-maskable.png', masked);

  // Apple launch screens: [css width, css height, dpr]
  const devices = [
    [440, 956, 3], [430, 932, 3], [402, 874, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
    [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2],
    [1024, 1366, 2], [834, 1194, 2], [820, 1180, 2], [810, 1080, 2], [768, 1024, 2], [744, 1133, 2],
  ];
  const links = [];
  for (const [w, h, dpr] of devices) {
    for (const orient of ['portrait', 'landscape']) {
      const cw = orient === 'portrait' ? w : h;
      const ch = orient === 'portrait' ? h : w;
      const c = await browser.newContext({ viewport: { width: cw, height: ch }, deviceScaleFactor: dpr });
      const page = await c.newPage();
      const iconSize = Math.round(Math.min(cw, ch) * 0.32);
      await page.setContent(`<style>${fontFace}</style><body style="margin:0;width:${cw}px;height:${ch}px;background:linear-gradient(#e6f6fd,#c4e9fb);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:${CJK}">
        <img src="${dataUrl(svg)}" style="width:${iconSize}px;height:${iconSize}px;border-radius:${Math.round(iconSize * 0.22)}px;box-shadow:0 10px 30px rgba(32,95,140,.25)">
        <div style="margin-top:${Math.round(iconSize * 0.16)}px;${logoCss(Math.round(iconSize * 0.3))}">Quack-doku</div>
        <div style="margin-top:8px;font-size:${Math.round(iconSize * 0.11)}px;font-weight:700;color:#587083">鸭鸭数独 · 鴨鴨數獨</div></body>`);
      await page.waitForTimeout(150);
      const file = `splash/${cw * dpr}x${ch * dpr}.png`;
      await page.screenshot({ path: 'public/' + file });
      links.push(`    <link rel="apple-touch-startup-image" href="${file}" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orient})" />`);
      await c.close();
    }
  }
  // Replace everything from the SPLASH marker up to the canonical link.
  const html = readFileSync('index.html', 'utf8');
  const start = html.indexOf('    <!-- SPLASH');
  const canon = html.indexOf('    <link rel="canonical"');
  if (start < 0 || canon < start) throw new Error('index.html needs a <!-- SPLASH --> marker before the canonical link');
  const block = `    <!-- SPLASH: iOS launch screens, one per device size and orientation (generated by scripts/assets.mjs) -->\n${links.join('\n')}\n`;
  writeFileSync('index.html', html.slice(0, start) + block + html.slice(canon));
  console.error(`wrote ${links.length} splash screens`);
}

// Open Graph cover: a real 8×8 level, most ducks placed with auto-cross on, title on the right.
{
  const unlock = () => {
    const levels = {};
    for (let k = 1; k < 200; k++) levels[k] = { ms: 60000, hints: 0, at: 1 };
    localStorage.setItem('quack-doku.progress', JSON.stringify({ v: 1, levels }));
    localStorage.setItem('quack-doku.settings', JSON.stringify({ v: 1, autoX: true, timer: true, patterns: false, haptics: false }));
    localStorage.setItem('quack-doku.muted', '1');
  };
  const { ctx, p } = await gamePage({ width: 1200, height: 630 }, '?lang=en&test#/level/150', unlock);
  await p.waitForFunction(() => window.__game.state()?.n === 8);
  await p.addStyleTag({
    content: `
      ${fontFace}
      #topbar, .dock { display: none !important; }
      #app { max-width: none; padding: 0; }
      #view { padding: 0; }
      .game { --bs: 540px; position: absolute; left: 60px; top: 45px; }
      .cover { position: absolute; top: 0; bottom: 0; right: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; font-family: FredokaArt, ${CJK}; color: #23384a; }
      .cover img { width: 150px; height: 150px; border-radius: 34px; box-shadow: 0 10px 30px rgba(32,95,140,.25); }
      .cover h1 { margin: 22px 0 0; ${logoCss(86)} }
      .cover .zh { margin-top: 6px; font: 700 34px ${CJK}; letter-spacing: 4px; color: #587083; }
      .cover p { margin: 18px 0 0; font-size: 25px; line-height: 1.35; font-weight: 600; max-width: 470px; }
      .cover .langs { margin-top: 12px; font-size: 19px; color: #587083; font-weight: 600; }
    `,
  });
  const sol = await p.evaluate(() => window.__game.solution());
  for (const cell of sol.slice(0, 6)) {
    const c = await p.evaluate((i) => window.__game.cellCenter(i), cell);
    await p.mouse.click(c.x, c.y, { button: 'right' });
  }
  const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(readFileSync('public/icon.svg')).toString('base64');
  await p.evaluate(async (iconUrl) => {
    const box = document.createElement('div');
    box.className = 'cover';
    box.innerHTML = `<img src="${iconUrl}" alt=""><h1>Quack-doku</h1><div class="zh">鸭鸭数独</div><p>One rubber duck in every row, column and colour. No two ducks may touch!</p><div class="langs">400 levels · Daily Duck · English · 简体中文 · 繁體中文 · Español</div>`;
    document.getElementById('app').append(box);
    await document.fonts.ready;
  }, iconUrl);
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'public/cover.png' });
  await ctx.close();
}
await browser.close();
stop();
console.error('assets generated');
