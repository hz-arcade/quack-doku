import { CAND, COL, DUCK, REGION, ROW, X, type Geo, type UnitKind } from './grid.ts';

/**
 * Human-style deductions, easiest first. The grader solves with them to rate puzzles, the
 * generator uses the grader to accept puzzles, and the hint engine shows the next one.
 *
 * Tier ids are stored in the puzzle packs; never renumber them.
 */
export const TIER = {
  /** Cross out what a placed duck sees (bookkeeping). */
  clear: 0,
  /** A row, column or region has one free cell left. */
  single: 1,
  /** A unit's free cells all lie in one other unit, so the rest of that unit is out. */
  confine: 2,
  /** Every free cell of a unit sees some cell, so that cell is out. */
  block: 3,
  /** k units of one kind fit in exactly k units of another kind. */
  pigeon: 4,
  /** A duck here forces a chain of singles that leaves some unit empty. */
  whatif: 5,
  unsolved: 9,
} as const;

export type Deduction =
  | { tech: 'clear'; duck: number; elim: number[] }
  | { tech: 'single'; unit: number; place: number }
  | { tech: 'confine'; unit: number; into: number; elim: number[] }
  | { tech: 'block'; unit: number; elim: number[] }
  | { tech: 'pigeon'; units: number[]; into: number[]; elim: number[] }
  | { tech: 'whatif'; assume: number; chain: number[]; chainUnits: number[]; broken: number; elim: number[] };

export interface Step {
  d: Deduction;
  tier: number;
  /** How many deductions of this tier were available at this point (1 = a bottleneck). */
  options: number;
}

export interface FindOptions {
  /** Hardest tier to look for. */
  maxTier?: number;
  /** Longest what-if chain (number of forced ducks) to try. */
  maxChain?: number;
}

export function tierOf(d: Deduction): number {
  return TIER[d.tech];
}

/** Put a duck on `cell` and cross out every candidate it sees. Returns the crossed cells. */
export function placeDuck(geo: Geo, m: Uint8Array, cell: number): number[] {
  m[cell] = DUCK;
  const out: number[] = [];
  for (const s of geo.sees[cell]!) {
    if (m[s] === CAND) {
      m[s] = X;
      out.push(s);
    }
  }
  return out;
}

export function applyDeduction(geo: Geo, m: Uint8Array, d: Deduction): void {
  if (d.tech === 'single') {
    placeDuck(geo, m, d.place);
    return;
  }
  for (const c of d.elim) if (m[c] === CAND) m[c] = X;
}

/**
 * Per-unit summary: `count[u]` is -1 when the unit has a duck, else its number of candidates;
 * `last[u]` is one of its candidates (the last in cell order).
 */
export interface UnitScan {
  count: Int16Array;
  last: Int16Array;
}

export function scanUnits(geo: Geo, m: Uint8Array, scan?: UnitScan): UnitScan {
  const nu = geo.units.length;
  const s = scan ?? { count: new Int16Array(nu), last: new Int16Array(nu) };
  for (let u = 0; u < nu; u++) {
    let count = 0;
    let last = -1;
    for (const c of geo.units[u]!) {
      const v = m[c];
      if (v === DUCK) {
        count = -1;
        break;
      }
      if (v === CAND) {
        count++;
        last = c;
      }
    }
    s.count[u] = count;
    s.last[u] = last;
  }
  return s;
}

/** Unit order for reporting: regions first (they read most naturally), then rows, then columns. */
function unitOrder(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(2 * n + i);
  for (let i = 0; i < n; i++) out.push(i);
  for (let i = 0; i < n; i++) out.push(n + i);
  return out;
}

const orderCache = new Map<number, number[]>();
function order(n: number): number[] {
  let o = orderCache.get(n);
  if (!o) {
    o = unitOrder(n);
    orderCache.set(n, o);
  }
  return o;
}

/** First unit that has no duck and no candidates, or -1. */
export function brokenUnit(geo: Geo, scan: UnitScan): number {
  for (const u of order(geo.n)) if (scan.count[u] === 0) return u;
  return -1;
}

/** Two ducks that see each other, or null. */
export function duckClash(geo: Geo, m: Uint8Array): [number, number] | null {
  for (let a = 0; a < geo.size; a++) {
    if (m[a] !== DUCK) continue;
    for (const b of geo.sees[a]!) if (b > a && m[b] === DUCK) return [a, b];
  }
  return null;
}

export function countDucks(m: Uint8Array): number {
  let k = 0;
  for (let i = 0; i < m.length; i++) if (m[i] === DUCK) k++;
  return k;
}

export function findClears(geo: Geo, m: Uint8Array): Deduction[] {
  const out: Deduction[] = [];
  for (let c = 0; c < geo.size; c++) {
    if (m[c] !== DUCK) continue;
    const elim: number[] = [];
    for (const s of geo.sees[c]!) if (m[s] === CAND) elim.push(s);
    if (elim.length) out.push({ tech: 'clear', duck: c, elim });
  }
  return out;
}

export function findSingles(geo: Geo, m: Uint8Array, scan = scanUnits(geo, m)): Deduction[] {
  const out: Deduction[] = [];
  const placed = new Set<number>();
  for (const u of order(geo.n)) {
    if (scan.count[u] !== 1) continue;
    const place = scan.last[u]!;
    if (placed.has(place)) continue;
    placed.add(place);
    out.push({ tech: 'single', unit: u, place });
  }
  return out;
}

function candsOf(geo: Geo, m: Uint8Array, u: number): number[] {
  const out: number[] = [];
  for (const c of geo.units[u]!) if (m[c] === CAND) out.push(c);
  return out;
}

/** The unit of the given kind that contains all of `cells`, or -1. */
function commonUnit(geo: Geo, cells: readonly number[], kind: UnitKind): number {
  const u = geo.cellUnits[cells[0]! * 3 + kind]!;
  for (const c of cells) if (geo.cellUnits[c * 3 + kind] !== u) return -1;
  return u;
}

export function findConfines(geo: Geo, m: Uint8Array, scan = scanUnits(geo, m)): Deduction[] {
  const out: Deduction[] = [];
  const n = geo.n;
  for (const u of order(n)) {
    if (scan.count[u]! < 2) continue;
    const kind = Math.floor(u / n);
    const cands = candsOf(geo, m, u);
    for (const k of [REGION, ROW, COL] as const) {
      if (k === kind) continue;
      const v = commonUnit(geo, cands, k);
      if (v < 0) continue;
      const inU = new Set(cands);
      const elim = candsOf(geo, m, v).filter((c) => !inU.has(c));
      if (elim.length) out.push({ tech: 'confine', unit: u, into: v, elim });
    }
  }
  return out;
}

export function findBlocks(geo: Geo, m: Uint8Array, scan = scanUnits(geo, m)): Deduction[] {
  const out: Deduction[] = [];
  const bits = geo.seesBits;
  for (const u of order(geo.n)) {
    if (scan.count[u]! < 2) continue;
    let w0 = -1;
    let w1 = -1;
    let w2 = -1;
    let w3 = -1;
    for (const c of geo.units[u]!) {
      if (m[c] !== CAND) continue;
      w0 &= bits[c * 4]!;
      w1 &= bits[c * 4 + 1]!;
      w2 &= bits[c * 4 + 2]!;
      w3 &= bits[c * 4 + 3]!;
    }
    const words = [w0, w1, w2, w3];
    const elim: number[] = [];
    for (let c = 0; c < geo.size; c++) {
      if (m[c] === CAND && words[c >> 5]! & (1 << (c & 31))) elim.push(c);
    }
    if (elim.length) out.push({ tech: 'block', unit: u, elim });
  }
  return out;
}

function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

const PIGEON_PAIRS: readonly [UnitKind, UnitKind][] = [
  [REGION, ROW],
  [REGION, COL],
  [ROW, REGION],
  [COL, REGION],
  [ROW, COL],
  [COL, ROW],
];

/**
 * k units of kind A whose candidates lie in exactly k units of kind B: those B units take
 * their ducks from the A units, so every other candidate in them goes. Covers k = 2..m/2;
 * larger k is the same deduction as the complementary set with A and B swapped. Returns the
 * deductions with the smallest k that has any.
 */
export function findPigeons(geo: Geo, m: Uint8Array, scan = scanUnits(geo, m)): Deduction[] {
  const n = geo.n;
  const out: Deduction[] = [];
  for (let k = 2; 2 * k <= n; k++) {
    for (const [A, B] of PIGEON_PAIRS) {
      const idx: number[] = [];
      const masks: number[] = [];
      for (let i = 0; i < n; i++) {
        const u = A * n + i;
        if (scan.count[u]! < 0) continue;
        let mask = 0;
        for (const c of geo.units[u]!) if (m[c] === CAND) mask |= 1 << (geo.cellUnits[c * 3 + B]! - B * n);
        idx.push(i);
        masks.push(mask);
      }
      const total = idx.length;
      if (2 * k > total) continue;
      const pick: number[] = [];
      const rec = (start: number, union: number): void => {
        if (popcount(union) > k) return;
        if (pick.length === k) {
          if (popcount(union) !== k) return;
          let setA = 0;
          for (const p of pick) setA |= 1 << idx[p]!;
          const elim: number[] = [];
          const into: number[] = [];
          for (let b = 0; b < n; b++) {
            if (!(union & (1 << b))) continue;
            into.push(B * n + b);
            for (const c of geo.units[B * n + b]!) {
              if (m[c] !== CAND) continue;
              const a = geo.cellUnits[c * 3 + A]! - A * n;
              if (!(setA & (1 << a))) elim.push(c);
            }
          }
          if (elim.length) out.push({ tech: 'pigeon', units: pick.map((p) => A * n + idx[p]!), into, elim });
          return;
        }
        for (let p = start; p <= total - (k - pick.length); p++) {
          pick.push(p);
          rec(p + 1, union | masks[p]!);
          pick.pop();
        }
      };
      rec(0, 0);
    }
    if (out.length) return out;
  }
  return out;
}

interface Probe {
  chain: number[];
  chainUnits: number[];
  broken: number;
}

/** Assume a duck on `cell`; place forced singles until some unit is left empty (or give up). */
function probe(geo: Geo, m: Uint8Array, cell: number, maxChain: number, scan: UnitScan): Probe | null {
  const w = m.slice();
  placeDuck(geo, w, cell);
  const chain: number[] = [];
  const chainUnits: number[] = [];
  const ord = order(geo.n);
  for (;;) {
    scanUnits(geo, w, scan);
    const broken = brokenUnit(geo, scan);
    if (broken >= 0) return { chain, chainUnits, broken };
    if (chain.length >= maxChain) return null;
    let next = -1;
    for (const u of ord) {
      if (scan.count[u] === 1) {
        next = u;
        break;
      }
    }
    if (next < 0) return null;
    const place = scan.last[next]!;
    placeDuck(geo, w, place);
    chain.push(place);
    chainUnits.push(next);
  }
}

/**
 * Shortest what-if: try cells in the tightest units first and keep the shortest chain that
 * ends in an empty unit. Returns at most one deduction.
 */
export function findWhatif(geo: Geo, m: Uint8Array, maxChain: number, scan = scanUnits(geo, m)): Deduction[] {
  const cells: number[] = [];
  const tight: number[] = [];
  for (let c = 0; c < geo.size; c++) {
    if (m[c] !== CAND) continue;
    let t = 99;
    for (let k = 0; k < 3; k++) t = Math.min(t, scan.count[geo.cellUnits[c * 3 + k]!]!);
    cells.push(c);
    tight[c] = t;
  }
  cells.sort((a, b) => tight[a]! - tight[b]! || a - b);
  let best: Probe | null = null;
  let bestCell = -1;
  let cap = maxChain;
  const work: UnitScan = { count: new Int16Array(geo.units.length), last: new Int16Array(geo.units.length) };
  for (const c of cells) {
    const p = probe(geo, m, c, cap, work);
    if (p && (!best || p.chain.length < best.chain.length)) {
      best = p;
      bestCell = c;
      cap = p.chain.length - 1;
      if (cap < 1) break;
    }
  }
  if (!best) return [];
  return [{ tech: 'whatif', assume: bestCell, chain: best.chain, chainUnits: best.chainUnits, broken: best.broken, elim: [bestCell] }];
}

export const DEFAULT_MAX_CHAIN = 6;

/**
 * The easiest available deduction (with how many alternatives its tier had), null when
 * nothing applies, or 'contradiction' when the marks already break a rule.
 */
export function nextStep(geo: Geo, m: Uint8Array, opts: FindOptions = {}): Step | 'contradiction' | null {
  const maxTier = opts.maxTier ?? TIER.whatif;
  const clears = findClears(geo, m);
  if (clears.length) return { d: clears[0]!, tier: TIER.clear, options: clears.length };
  if (duckClash(geo, m)) return 'contradiction';
  const scan = scanUnits(geo, m);
  if (brokenUnit(geo, scan) >= 0) return 'contradiction';
  const tiers: [number, () => Deduction[]][] = [
    [TIER.single, () => findSingles(geo, m, scan)],
    [TIER.confine, () => findConfines(geo, m, scan)],
    [TIER.block, () => findBlocks(geo, m, scan)],
    [TIER.pigeon, () => findPigeons(geo, m, scan)],
    [TIER.whatif, () => findWhatif(geo, m, opts.maxChain ?? DEFAULT_MAX_CHAIN, scan)],
  ];
  for (const [tier, find] of tiers) {
    if (tier > maxTier) break;
    const found = find();
    if (found.length) return { d: found[0]!, tier, options: found.length };
  }
  return null;
}

export interface SolveResult {
  solved: boolean;
  steps: Step[];
  /** Final marks. */
  marks: Uint8Array;
}

/** Solve from `start` (default: empty board) using deductions up to the given tier. */
export function solveLogically(geo: Geo, opts: FindOptions = {}, start?: Uint8Array): SolveResult {
  const m = start ? start.slice() : new Uint8Array(geo.size);
  const steps: Step[] = [];
  for (let guard = 0; guard < geo.size * 4; guard++) {
    if (countDucks(m) === geo.n) return { solved: duckClash(geo, m) === null, steps, marks: m };
    const s = nextStep(geo, m, opts);
    if (s === null || s === 'contradiction') return { solved: false, steps, marks: m };
    steps.push(s);
    applyDeduction(geo, m, s.d);
  }
  return { solved: false, steps, marks: m };
}
