import { MAX_N, MIN_N, orthoNeighbours } from './grid.ts';

/**
 * A puzzle as stored in the packs. `r` holds one letter per cell (row-major, 'a' = region 0)
 * and `s` the solution as one base-36 column per row. The rest is metadata written by the
 * generator: `id` identifies the puzzle up to rotation, reflection and region relabelling,
 * `d` is the difficulty score, `t` the hardest technique needed and `w` the number of
 * what-if steps in the reference solve.
 */
export interface PackPuzzle {
  n: number;
  r: string;
  s: string;
  id: string;
  d: number;
  t: number;
  w: number;
}

export interface Puzzle {
  n: number;
  region: Uint8Array;
  /** Column of the duck in each row. */
  solution: number[];
}

export function parseRegions(n: number, r: string): Uint8Array {
  if (r.length !== n * n) throw new Error(`regions: expected ${n * n} letters, got ${r.length}`);
  const out = new Uint8Array(n * n);
  for (let i = 0; i < r.length; i++) {
    const v = r.charCodeAt(i) - 97;
    if (v < 0 || v >= n) throw new Error(`regions: bad letter ${r[i]}`);
    out[i] = v;
  }
  return out;
}

export function regionsToString(region: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < region.length; i++) s += String.fromCharCode(97 + region[i]!);
  return s;
}

export function parseSolution(n: number, s: string): number[] {
  if (s.length !== n) throw new Error(`solution: expected ${n} columns`);
  return Array.from(s, (ch) => {
    const v = parseInt(ch, 36);
    if (!(v >= 0 && v < n)) throw new Error(`solution: bad column ${ch}`);
    return v;
  });
}

export function solutionToString(cols: readonly number[]): string {
  return cols.map((c) => c.toString(36)).join('');
}

export function fromPack(p: PackPuzzle): Puzzle {
  return { n: p.n, region: parseRegions(p.n, p.r), solution: parseSolution(p.n, p.s) };
}

/**
 * Structural problems with a region map, or [] when it is well formed: every region index
 * 0..n-1 is used and each region is one orthogonally connected piece.
 */
export function structureProblems(n: number, region: ArrayLike<number>): string[] {
  const problems: string[] = [];
  if (n < MIN_N || n > MAX_N) problems.push(`size ${n} out of range`);
  if (region.length !== n * n) return [...problems, 'wrong cell count'];
  const sizes = new Array<number>(n).fill(0);
  for (let i = 0; i < region.length; i++) sizes[region[i]!]!++;
  for (let g = 0; g < n; g++) {
    if (sizes[g] === 0) {
      problems.push(`region ${g} empty`);
      continue;
    }
    const start = Array.prototype.indexOf.call(region, g) as number;
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length) {
      const c = stack.pop()!;
      for (const d of orthoNeighbours(n, c)) {
        if (region[d] === g && !seen.has(d)) {
          seen.add(d);
          stack.push(d);
        }
      }
    }
    if (seen.size !== sizes[g]) problems.push(`region ${g} not connected`);
  }
  return problems;
}

/** Whether `cols` puts one duck per row, column and region with no two touching. */
export function isSolution(n: number, region: ArrayLike<number>, cols: readonly number[]): boolean {
  if (cols.length !== n) return false;
  let usedCols = 0;
  let usedRegions = 0;
  for (let r = 0; r < n; r++) {
    const c = cols[r]!;
    if (!(c >= 0 && c < n)) return false;
    if (usedCols & (1 << c)) return false;
    usedCols |= 1 << c;
    const g = region[r * n + c]!;
    if (usedRegions & (1 << g)) return false;
    usedRegions |= 1 << g;
    if (r > 0 && Math.abs(cols[r - 1]! - c) <= 1) return false;
  }
  return true;
}

/** Map a cell through one of the 8 symmetries of the square. */
function transform(n: number, sym: number, r: number, c: number): number {
  const m = n - 1;
  let rr = r;
  let cc = c;
  if (sym & 4) [rr, cc] = [cc, rr];
  if (sym & 1) rr = m - rr;
  if (sym & 2) cc = m - cc;
  return rr * n + cc;
}

/**
 * Canonical form: under each symmetry, relabel regions by first appearance in reading order;
 * keep the lexicographically smallest string. Two puzzles are the same up to symmetry and
 * colouring exactly when their canonical forms match.
 */
export function canonicalForm(n: number, region: ArrayLike<number>): string {
  let best = '';
  for (let sym = 0; sym < 8; sym++) {
    const out = new Array<number>(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[transform(n, sym, r, c)] = region[r * n + c]!;
    const relabel = new Map<number, number>();
    let s = '';
    for (const g of out) {
      let v = relabel.get(g);
      if (v === undefined) {
        v = relabel.size;
        relabel.set(g, v);
      }
      s += String.fromCharCode(97 + v);
    }
    if (best === '' || s < best) best = s;
  }
  return best;
}

/** FNV-1a, 32-bit. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function puzzleId(n: number, region: ArrayLike<number>): string {
  return fnv1a(`${n}:${canonicalForm(n, region)}`).toString(16).padStart(8, '0');
}
