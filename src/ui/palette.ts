import type { Geo } from '../engine/grid.ts';

/**
 * Ten pastel bath-toy colours, spread around the OKLab hue wheel with alternating lightness.
 * Saturated yellow is left out so the ducks stand out. Indices match the colour names in
 * the i18n tables ('color.0' … 'color.9'). Pastels are close by nature, so colours are
 * assigned per puzzle: regions that touch get the most different pairs.
 */
export const PALETTE_LIGHT: readonly string[] = ['#f8b4cd', '#f7a792', '#fbd3a5', '#d0ef9d', '#a0e3be', '#96dce4', '#9bc1f1', '#cbbdf9', '#cf9ed1', '#d2d8df'];
export const PALETTE_DARK: readonly string[] = ['#b97992', '#b76c59', '#bd976b', '#95b162', '#64a683', '#5b9fa7', '#6285b3', '#9082bb', '#926495', '#969ca3'];

type Lab = [number, number, number];

function lin(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function oklab(hex: string): Lab {
  const r = lin(parseInt(hex.slice(1, 3), 16));
  const g = lin(parseInt(hex.slice(3, 5), 16));
  const b = lin(parseInt(hex.slice(5, 7), 16));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function colourDistance(a: string, b: string): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const DIST: number[][] = PALETTE_LIGHT.map((a) => PALETTE_LIGHT.map((b) => colourDistance(a, b)));

/** Pairs of regions that share an edge or a corner. */
export function regionNeighbours(geo: Geo): [number, number][] {
  const n = geo.n;
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = geo.region[r * n + c]!;
      for (const [dr, dc] of [
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ] as const) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= n || cc < 0 || cc >= n) continue;
        const b = geo.region[rr * n + cc]!;
        if (a === b) continue;
        const key = Math.min(a, b) * 16 + Math.max(a, b);
        if (!seen.has(key)) {
          seen.add(key);
          out.push([Math.min(a, b), Math.max(a, b)]);
        }
      }
    }
  }
  return out;
}

/** Sorted distances of neighbouring pairs, for comparing assignments (bigger is better). */
function quality(colours: readonly number[], pairs: readonly [number, number][]): number[] {
  return pairs.map(([a, b]) => DIST[colours[a]!]![colours[b]!]!).sort((x, y) => x - y);
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 1e-9) return a[i]! > b[i]!;
  }
  return false;
}

/**
 * Palette index for every region: a deterministic local search that swaps colours between
 * regions (or with unused colours) while it improves the closest neighbouring pair, then
 * the next closest, and so on.
 */
export function assignColours(geo: Geo): number[] {
  const n = geo.n;
  const pairs = regionNeighbours(geo);
  // Slots 0..n-1 are regions; slots n..9 hold the unused colours.
  const slots = [...Array(PALETTE_LIGHT.length).keys()];
  let best = quality(slots, pairs);
  for (let improved = true, guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        [slots[i], slots[j]] = [slots[j]!, slots[i]!];
        const q = quality(slots, pairs);
        if (better(q, best)) {
          best = q;
          improved = true;
        } else {
          [slots[i], slots[j]] = [slots[j]!, slots[i]!];
        }
      }
    }
  }
  return slots.slice(0, n);
}
