import type { Target } from './generate.ts';
import { TIER } from './logic.ts';

/**
 * The level ladder and the daily schedule: board size, hardest technique allowed and a
 * difficulty band for every slot. Bands rise linearly through each segment; every level
 * ending in 5 is a breather from earlier in its segment. Score scale (measured on the Pi,
 * 2026-10-07): singles-only 5×5 puzzles score ~5, hill-climbed pigeonhole puzzles 25–60,
 * puzzles with what-if steps 50–100.
 */
interface Segment {
  from: number;
  to: number;
  n: number;
  maxTier: number;
  maxWhatifs: number;
  maxChain: number;
  /** Band at the first and last level of the segment. */
  start: [number, number];
  end: [number, number];
  maxTiny?: number;
}

const P = TIER.pigeon;
const W = TIER.whatif;

const SEGMENTS: readonly Segment[] = [
  // Tutorials: singles only, a tiny region or two to start from.
  { from: 1, to: 3, n: 5, maxTier: TIER.single, maxWhatifs: 0, maxChain: 0, start: [0, 7], end: [0, 8], maxTiny: 3 },
  { from: 4, to: 10, n: 5, maxTier: TIER.confine, maxWhatifs: 0, maxChain: 0, start: [5, 10], end: [8, 14] },
  { from: 11, to: 20, n: 5, maxTier: P, maxWhatifs: 0, maxChain: 0, start: [10, 18], end: [16, 26] },
  { from: 21, to: 30, n: 6, maxTier: TIER.block, maxWhatifs: 0, maxChain: 0, start: [8, 14], end: [12, 20] },
  { from: 31, to: 60, n: 6, maxTier: P, maxWhatifs: 0, maxChain: 0, start: [14, 22], end: [28, 42] },
  { from: 61, to: 75, n: 7, maxTier: P, maxWhatifs: 0, maxChain: 0, start: [14, 22], end: [24, 34] },
  { from: 76, to: 120, n: 7, maxTier: W, maxWhatifs: 1, maxChain: 2, start: [22, 32], end: [40, 58] },
  { from: 121, to: 140, n: 8, maxTier: P, maxWhatifs: 0, maxChain: 0, start: [18, 26], end: [28, 38] },
  { from: 141, to: 200, n: 8, maxTier: W, maxWhatifs: 2, maxChain: 3, start: [26, 36], end: [48, 66] },
  { from: 201, to: 230, n: 9, maxTier: P, maxWhatifs: 0, maxChain: 0, start: [22, 30], end: [32, 44] },
  { from: 231, to: 300, n: 9, maxTier: W, maxWhatifs: 2, maxChain: 3, start: [30, 42], end: [55, 75] },
  { from: 301, to: 330, n: 10, maxTier: P, maxWhatifs: 0, maxChain: 0, start: [26, 36], end: [38, 50] },
  { from: 331, to: 400, n: 10, maxTier: W, maxWhatifs: 3, maxChain: 3, start: [36, 48], end: [60, 80] },
];

export const LEVEL_COUNT = SEGMENTS[SEGMENTS.length - 1]!.to;

/** Board sizes in level order, for the level picker: [n, first level, last level]. */
export const LEVEL_SIZES: readonly [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  for (const s of SEGMENTS) {
    const last = out[out.length - 1];
    if (last && last[0] === s.n) last[2] = s.to;
    else out.push([s.n, s.from, s.to]);
  }
  return out;
})();

export function levelSize(k: number): number {
  return segmentOf(k).n;
}

function segmentOf(k: number): Segment {
  const s = SEGMENTS.find((x) => k >= x.from && k <= x.to);
  if (!s) throw new Error(`no level ${k}`);
  return s;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function levelTarget(k: number): Target {
  const s = segmentOf(k);
  let f = s.to === s.from ? 0 : (k - s.from) / (s.to - s.from);
  if (k % 10 === 5) f = Math.max(0, f - 0.35);
  const lo = round1(s.start[0] + (s.end[0] - s.start[0]) * f);
  const hi = round1(s.start[1] + (s.end[1] - s.start[1]) * f);
  return {
    n: s.n,
    maxTier: s.maxTier,
    maxWhatifs: s.maxWhatifs,
    maxChain: s.maxChain,
    lo,
    hi,
    ...(s.maxTiny !== undefined ? { shape: { maxTiny: s.maxTiny } } : {}),
  };
}

/** Daily targets by weekday (Monday first); sizes match shared/day.ts DAILY_SIZES. */
const DAILY: readonly Omit<Target, 'n'>[] = [
  { maxTier: P, maxWhatifs: 0, maxChain: 0, lo: 26, hi: 40 },
  { maxTier: P, maxWhatifs: 0, maxChain: 0, lo: 26, hi: 40 },
  { maxTier: P, maxWhatifs: 0, maxChain: 0, lo: 30, hi: 46 },
  { maxTier: P, maxWhatifs: 0, maxChain: 0, lo: 30, hi: 46 },
  { maxTier: W, maxWhatifs: 1, maxChain: 2, lo: 38, hi: 58 },
  { maxTier: W, maxWhatifs: 1, maxChain: 2, lo: 38, hi: 58 },
  { maxTier: W, maxWhatifs: 2, maxChain: 3, lo: 44, hi: 68 },
];

export function dailyTarget(weekday: number, n: number): Target {
  return { n, ...DAILY[weekday]! };
}
