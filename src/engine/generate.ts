import { countSolutions } from './count.ts';
import { grade, type Grade } from './difficulty.ts';
import { makeGeo, orthoNeighbours } from './grid.ts';
import { TIER } from './logic.ts';
import { puzzleId, regionsToString, solutionToString, type PackPuzzle } from './puzzle.ts';
import { Rng, subSeed } from './rng.ts';

/**
 * Puzzle generator. Everything is driven by one seeded Rng and integer arithmetic, so a seed
 * gives the same puzzle on every machine.
 *
 * 1. Plant a solution: a random permutation with no two ducks in adjacent rows touching.
 * 2. Grow one region from each duck.
 * 3. Repair: while other solutions exist, move a cell that alternative solutions use into a
 *    neighbouring region (that region then holds two of their ducks, killing them).
 * 4. Smooth ragged borders while the puzzle stays unique.
 * 5. Hill-climb with random border moves until the logical difficulty lands in the target
 *    band, staying within the technique cap and shape limits.
 */

export interface Shape {
  /** Each region draws a growth weight from this table. Skew makes big and small regions. */
  weights: readonly number[];
  /** Percent chance that a growth step prefers the frontier cell with most same-region neighbours. */
  compact: number;
  /** Most regions allowed with at most two cells. */
  maxTiny: number;
  /** Largest region, in percent of the board. */
  maxRegionPct: number;
}

export interface Target {
  n: number;
  /** Hardest technique allowed (TIER value). */
  maxTier: number;
  /** Longest what-if chain allowed. */
  maxChain: number;
  /** Most what-if steps allowed. */
  maxWhatifs: number;
  /** Accept difficulty scores in [lo, hi]. */
  lo: number;
  hi: number;
  shape?: Partial<Shape>;
  /** Hill-climb moves per attempt. */
  climb?: number;
  /** Seeds tried before giving up. */
  attempts?: number;
}

export const DEFAULT_SHAPE: Shape = { weights: [1, 1, 2, 2, 3, 4, 6], compact: 60, maxTiny: 2, maxRegionPct: 30 };

export function randomSolution(n: number, rng: Rng): number[] {
  const cols = Array.from({ length: n }, (_, i) => i);
  for (;;) {
    rng.shuffle(cols);
    let ok = true;
    for (let r = 1; r < n && ok; r++) if (Math.abs(cols[r]! - cols[r - 1]!) <= 1) ok = false;
    if (ok) return cols;
  }
}

export function growRegions(n: number, sol: readonly number[], rng: Rng, shape: Shape): Uint8Array {
  const size = n * n;
  const region = new Int8Array(size).fill(-1);
  const sizes = new Array<number>(n).fill(1);
  for (let r = 0; r < n; r++) region[r * n + sol[r]!] = r;
  const weights = Array.from({ length: n }, () => rng.pick(shape.weights));
  const cap = Math.max(2, Math.floor((size * shape.maxRegionPct) / 100));
  let left = size - n;
  while (left > 0) {
    // Frontier of every region: unassigned cells next to it.
    const frontier: number[][] = Array.from({ length: n }, () => []);
    for (let c = 0; c < size; c++) {
      if (region[c] !== -1) continue;
      const seen = new Set<number>();
      for (const d of orthoNeighbours(n, c)) {
        const g = region[d]!;
        if (g >= 0 && !seen.has(g)) {
          seen.add(g);
          frontier[g]!.push(c);
        }
      }
    }
    let eligible = [...Array(n).keys()].filter((g) => frontier[g]!.length > 0 && sizes[g]! < cap);
    if (eligible.length === 0) eligible = [...Array(n).keys()].filter((g) => frontier[g]!.length > 0);
    let total = 0;
    for (const g of eligible) total += weights[g]!;
    let x = rng.int(0, total - 1);
    let g = eligible[0]!;
    for (const e of eligible) {
      x -= weights[e]!;
      if (x < 0) {
        g = e;
        break;
      }
    }
    const cells = frontier[g]!;
    let cell: number;
    if (rng.int(0, 99) < shape.compact) {
      let best = -1;
      let pool: number[] = [];
      for (const c of cells) {
        let k = 0;
        for (const d of orthoNeighbours(n, c)) if (region[d] === g) k++;
        if (k > best) {
          best = k;
          pool = [c];
        } else if (k === best) pool.push(c);
      }
      cell = rng.pick(pool);
    } else {
      cell = rng.pick(cells);
    }
    region[cell] = g;
    sizes[g]!++;
    left--;
  }
  return Uint8Array.from(region);
}

/**
 * Move `cell` into region `to`. Any part of its old region cut off from that region's duck
 * moves along (it touches `cell`, so it stays connected to `to`). Returns the new map and
 * how many cells moved, or null when `cell` holds a duck.
 */
export function moveCell(n: number, region: Uint8Array, planted: readonly number[], cell: number, to: number): { region: Uint8Array; moved: number } | null {
  const from = region[cell]!;
  if (from === to) return null;
  const home = planted[from]!;
  if (home === cell) return null;
  const out = region.slice();
  out[cell] = to;
  const reach = new Set<number>([home]);
  const stack = [home];
  while (stack.length) {
    const c = stack.pop()!;
    for (const d of orthoNeighbours(n, c)) {
      if (out[d] === from && !reach.has(d)) {
        reach.add(d);
        stack.push(d);
      }
    }
  }
  let moved = 1;
  for (let c = 0; c < out.length; c++) {
    if (out[c] === from && !reach.has(c)) {
      out[c] = to;
      moved++;
    }
  }
  return { region: out, moved };
}

function plantedCells(n: number, region: Uint8Array, sol: readonly number[]): number[] {
  const planted = new Array<number>(n);
  for (let r = 0; r < n; r++) {
    const c = r * n + sol[r]!;
    planted[region[c]!] = c;
  }
  return planted;
}

const ALT_LIMIT = 64;

/** Remove alternative solutions. Returns the repaired map or null when stuck. */
export function repair(n: number, start: Uint8Array, sol: readonly number[], rng: Rng, maxIter = 60): Uint8Array | null {
  let region = start;
  const plantedSet = new Set(sol.map((c, r) => r * n + c));
  for (let iter = 0; iter < maxIter; iter++) {
    const sols: number[][] = [];
    const count = countSolutions(n, region, ALT_LIMIT, sols);
    if (count === 1) return region;
    const planted = plantedCells(n, region, sol);
    const hits = new Map<number, number>();
    for (const s of sols) {
      for (let r = 0; r < n; r++) {
        const c = r * n + s[r]!;
        if (!plantedSet.has(c)) hits.set(c, (hits.get(c) ?? 0) + 1);
      }
    }
    const moves: { cell: number; to: number; score: number }[] = [];
    for (const [cell, h] of hits) {
      const seen = new Set<number>();
      for (const d of orthoNeighbours(n, cell)) {
        const g = region[d]!;
        if (g !== region[cell] && !seen.has(g)) {
          seen.add(g);
          moves.push({ cell, to: g, score: h * 16 + rng.int(0, 15) });
        }
      }
    }
    if (moves.length === 0) return null;
    moves.sort((a, b) => b.score - a.score || a.cell - b.cell || a.to - b.to);
    let best: Uint8Array | null = null;
    let bestCount = Infinity;
    for (const mv of moves.slice(0, 8)) {
      const res = moveCell(n, region, planted, mv.cell, mv.to);
      if (!res) continue;
      const k = countSolutions(n, res.region, ALT_LIMIT);
      if (k < bestCount) {
        bestCount = k;
        best = res.region;
        if (k === 1) break;
      }
    }
    if (!best) return null;
    region = best;
  }
  return countSolutions(n, region, 2) === 1 ? region : null;
}

function isConnectedWithout(n: number, region: Uint8Array, g: number, without: number, home: number): boolean {
  let total = 0;
  for (let c = 0; c < region.length; c++) if (region[c] === g && c !== without) total++;
  const reach = new Set<number>([home]);
  const stack = [home];
  while (stack.length) {
    const c = stack.pop()!;
    for (const d of orthoNeighbours(n, c)) {
      if (d !== without && region[d] === g && !reach.has(d)) {
        reach.add(d);
        stack.push(d);
      }
    }
  }
  return reach.size === total;
}

/** Hand cells to the neighbouring region they mostly touch, keeping the solution unique. */
export function smooth(n: number, start: Uint8Array, sol: readonly number[], rng: Rng, passes = 2): Uint8Array {
  let region = start;
  const plantedSet = new Set(sol.map((c, r) => r * n + c));
  for (let p = 0; p < passes; p++) {
    let changed = false;
    const order = rng.shuffle([...Array(n * n).keys()]);
    for (const c of order) {
      if (plantedSet.has(c)) continue;
      const from = region[c]!;
      const counts = new Map<number, number>();
      for (const d of orthoNeighbours(n, c)) counts.set(region[d]!, (counts.get(region[d]!) ?? 0) + 1);
      const own = counts.get(from) ?? 0;
      let to = -1;
      let best = own;
      for (const [g, k] of counts) {
        if (g !== from && k > best) {
          best = k;
          to = g;
        }
      }
      if (to < 0) continue;
      const planted = plantedCells(n, region, sol);
      if (!isConnectedWithout(n, region, from, c, planted[from]!)) continue;
      const next = region.slice();
      next[c] = to;
      if (countSolutions(n, next, 2) !== 1) continue;
      region = next;
      changed = true;
    }
    if (!changed) break;
  }
  return region;
}

export function shapeViolation(n: number, region: Uint8Array, shape: Shape): number {
  const sizes = new Array<number>(n).fill(0);
  for (const g of region) sizes[g]!++;
  const cap = Math.max(2, Math.floor((n * n * shape.maxRegionPct) / 100));
  let tiny = 0;
  let over = 0;
  for (const s of sizes) {
    if (s <= 2) tiny++;
    if (s > cap) over += s - cap;
  }
  return Math.max(0, tiny - shape.maxTiny) + over;
}

interface Eval {
  grade: Grade;
  obj: number;
}

function evaluate(n: number, region: Uint8Array, t: Target, shape: Shape): Eval {
  const g = grade(makeGeo(n, region), { maxTier: t.maxTier, maxChain: t.maxChain });
  let obj = 0;
  if (!g.solved) obj += 1000;
  if (g.whatifs > t.maxWhatifs) obj += 200 + 20 * (g.whatifs - t.maxWhatifs);
  obj += 50 * shapeViolation(n, region, shape);
  if (g.score < t.lo) obj += t.lo - g.score;
  else if (g.score > t.hi) obj += g.score - t.hi;
  return { grade: g, obj };
}

/** Random border moves that never make the objective worse; stops once inside the band. */
export function climb(n: number, start: Uint8Array, sol: readonly number[], rng: Rng, t: Target, shape: Shape, moves: number): { region: Uint8Array; ev: Eval } {
  let region = start;
  let ev = evaluate(n, region, t, shape);
  const plantedSet = new Set(sol.map((c, r) => r * n + c));
  for (let i = 0; i < moves && ev.obj > 0; i++) {
    const c = rng.int(0, n * n - 1);
    if (plantedSet.has(c)) continue;
    const nb = orthoNeighbours(n, c).filter((d) => region[d] !== region[c]);
    if (nb.length === 0) continue;
    const to = region[rng.pick(nb)]!;
    const res = moveCell(n, region, plantedCells(n, region, sol), c, to);
    if (!res || res.moved > 3) continue;
    if (countSolutions(n, res.region, 2) !== 1) continue;
    const next = evaluate(n, res.region, t, shape);
    if (next.obj <= ev.obj) {
      region = res.region;
      ev = next;
    }
  }
  return { region, ev };
}

export interface Generated extends PackPuzzle {
  /** Attempt number that succeeded. */
  attempt: number;
}

/** Generate a puzzle meeting the target, or null after `attempts` seeds. */
export function generate(t: Target, seed: number): Generated | null {
  const n = t.n;
  const shape: Shape = { ...DEFAULT_SHAPE, ...t.shape };
  const attempts = t.attempts ?? 12;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rng = new Rng(subSeed(seed, attempt));
    const sol = randomSolution(n, rng);
    let region: Uint8Array | null = null;
    for (let regrow = 0; regrow < 5 && !region; regrow++) region = repair(n, growRegions(n, sol, rng, shape), sol, rng);
    if (!region) continue;
    region = smooth(n, region, sol, rng);
    const res = climb(n, region, sol, rng, t, shape, t.climb ?? 300);
    if (res.ev.obj > 0) continue;
    // Region i holds row i's duck until relabelled; shuffle so labels say nothing. Labels set
    // the order the grader scans regions in, so grade the final map again.
    const labels = rng.shuffle([...Array(n).keys()]);
    const final = res.region.map((g0) => labels[g0]!);
    const ev = evaluate(n, final, t, shape);
    if (ev.obj > 0) continue;
    const g = ev.grade;
    if (g.tier === TIER.unsolved) continue;
    return {
      n,
      r: regionsToString(final),
      s: solutionToString(sol),
      id: puzzleId(n, final),
      d: g.score,
      t: g.tier,
      w: g.whatifs,
      attempt,
    };
  }
  return null;
}
