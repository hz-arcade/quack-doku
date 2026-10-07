/**
 * The rubber duck, drawn as SVG so it stays crisp on any board size. One set of <symbol>s is
 * injected into the page and every cell shows it with <use>. iconSvg() builds a standalone
 * copy for the app icon, the favicon and the splash screens.
 */
export type DuckVariant = 'normal' | 'happy' | 'worried';

const INK = '#2a2433';
const OUTLINE = '#e48d0b';

/** Gradients and the silhouette. `p` prefixes ids so a standalone copy cannot clash. */
function defs(p: string): string {
  return `
  <radialGradient id="${p}body" cx="0.36" cy="0.28" r="0.85">
    <stop offset="0" stop-color="#fff7b8"/>
    <stop offset="0.42" stop-color="#ffd93b"/>
    <stop offset="1" stop-color="#f6ac00"/>
  </radialGradient>
  <linearGradient id="${p}beak" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffab5e"/>
    <stop offset="1" stop-color="#f2661c"/>
  </linearGradient>
  <g id="${p}shape">
    <path d="M24 60 Q7 47 12 36 Q22 40 38 50 Z"/>
    <ellipse cx="50" cy="66" rx="35" ry="21"/>
    <circle cx="64" cy="37" r="19"/>
  </g>`;
}

function eyes(v: DuckVariant): string {
  if (v === 'happy') {
    return `<path d="M65 33.5 Q69 27.5 73 33.5" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  const eye = `<ellipse cx="69" cy="32" rx="3.5" ry="4.3" fill="${INK}"/><circle cx="70.4" cy="30.3" r="1.35" fill="#fff"/>`;
  if (v === 'worried') {
    return `${eye}<path d="M64 27.5 L73.5 24" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<path d="M50 17 Q46.5 23 50 25 Q53.5 23 50 17 Z" fill="#8fd3f4" stroke="#4aa8d8" stroke-width="1"/>`;
  }
  return eye;
}

/** Everything inside the duck's 100×100 viewBox. */
function body(p: string, v: DuckVariant): string {
  const beak = v === 'happy'
    ? `<path d="M78 37 C88 32 98 34 97.5 40 C97 43 90 43.5 80 42 Z" fill="url(#${p}beak)" stroke="#d9561a" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M79.5 43 C86 44 94 44.5 94 47.5 C92 51 85 50.5 79 47.5 Z" fill="#e8551a" stroke="#c2461a" stroke-width="1.2" stroke-linejoin="round"/>`
    : `<path d="M78 37.5 C88 33 98 35 97.5 41.5 C97 47 88 49 79 46 Z" fill="url(#${p}beak)" stroke="#d9561a" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M80.5 42.2 Q88 43.2 96.5 42" fill="none" stroke="#c9501a" stroke-width="1.3" stroke-linecap="round"/>`;
  return `
    <ellipse cx="50" cy="89.5" rx="31" ry="4.6" fill="#1b3a4b" opacity=".16"/>
    <use href="#${p}shape" fill="${OUTLINE}" stroke="${OUTLINE}" stroke-width="7" stroke-linejoin="round"/>
    <use href="#${p}shape" fill="url(#${p}body)"/>
    <path d="M33 64 C40 54 56 54 62 62 C58 72 45 76 37 72 C33.5 70 32 67 33 64 Z" fill="#f8bf1c" stroke="#e9a20d" stroke-width="1.6"/>
    <path d="M42 63 Q48 60 54 63" fill="none" stroke="#e9a20d" stroke-width="1.4" stroke-linecap="round"/>
    <ellipse cx="57" cy="25.5" rx="6.5" ry="3.4" fill="#fff" opacity=".72" transform="rotate(-28 57 25.5)"/>
    <ellipse cx="29" cy="60" rx="8" ry="3.2" fill="#fff" opacity=".42" transform="rotate(-22 29 60)"/>
    <ellipse cx="66" cy="43.5" rx="5" ry="3" fill="#ff8fa3" opacity=".6"/>
    ${beak}
    ${eyes(v)}`;
}

const SYMBOL_IDS: Record<DuckVariant, string> = { normal: 'duck', happy: 'duck-happy', worried: 'duck-worried' };

/** Add the duck symbols to the page once. */
export function installDuckSymbols(): void {
  if (document.getElementById('duck-defs')) return;
  const wrap = document.createElement('div');
  wrap.id = 'duck-defs';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const symbols = (Object.keys(SYMBOL_IDS) as DuckVariant[])
    .map((v) => `<symbol id="${SYMBOL_IDS[v]}" viewBox="0 0 100 100">${body('dk-', v)}</symbol>`)
    .join('');
  // Static markup written by this module, no user data.
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><defs>${defs('dk-')}</defs>${symbols}</svg>`;
  document.body.prepend(wrap);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A duck element referencing the installed symbols. */
export function duckSvg(variant: DuckVariant = 'normal', className = 'duck'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${SYMBOL_IDS[variant]}`);
  svg.appendChild(use);
  return svg;
}

export function setDuckVariant(svg: SVGSVGElement, variant: DuckVariant): void {
  svg.querySelector('use')?.setAttribute('href', `#${SYMBOL_IDS[variant]}`);
}

/** Standalone duck in a 100×100 viewBox (for previews and tests). */
export function duckStandalone(variant: DuckVariant = 'normal'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${defs('s-')}</defs>${body('s-', variant)}</svg>`;
}

/**
 * App icon: the duck floating on bath water in a soft sky square. `padded` shrinks the art
 * into the maskable safe zone.
 */
export function iconSvg(size = 512, padded = false): string {
  const scale = padded ? 0.62 : 0.78;
  const d = 100 * scale;
  const ox = 50 - d / 2;
  const oy = 50 - d / 2 + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>${defs('i-')}
    <linearGradient id="i-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfeaff"/><stop offset="1" stop-color="#8fd3f4"/></linearGradient>
    <linearGradient id="i-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6cc4ec"/><stop offset="1" stop-color="#3fa4d8"/></linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#i-sky)"/>
  <circle cx="18" cy="20" r="5" fill="#fff" opacity=".55"/><circle cx="27" cy="12" r="2.6" fill="#fff" opacity=".5"/>
  <circle cx="84" cy="24" r="3.4" fill="#fff" opacity=".5"/>
  <g transform="translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${scale})">${body('i-', 'normal')}</g>
  <path d="M0 76 Q10 71 20 76 T40 76 T60 76 T80 76 T100 76 V100 H0 Z" fill="url(#i-water)" opacity=".92"/>
  <path d="M0 82 Q10 78 20 82 T40 82 T60 82 T80 82 T100 82" fill="none" stroke="#fff" stroke-width="1.6" opacity=".55"/>
</svg>`;
}
