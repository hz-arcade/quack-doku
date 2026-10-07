/**
 * Exhaustive solution counter: depth-first over rows, one duck per row, tracking used
 * columns and regions as bitmasks. Ducks in non-adjacent rows can never touch, so only the
 * previous row's column matters for the no-touching rule.
 */

/**
 * Count solutions up to `limit`. When `out` is given, each solution found is pushed to it as
 * the column of the duck in every row.
 */
export function countSolutions(n: number, region: ArrayLike<number>, limit = 2, out?: number[][]): number {
  // A region whose last row is above the current row can no longer get its duck.
  const lastRow = new Array<number>(n).fill(-1);
  for (let c = 0; c < n * n; c++) lastRow[region[c]!] = Math.floor(c / n);
  const deadBefore = new Array<number>(n + 1).fill(0);
  for (let r = 0; r <= n; r++) {
    let m = 0;
    for (let g = 0; g < n; g++) if (lastRow[g]! < r) m |= 1 << g;
    deadBefore[r] = m;
  }
  const cols = new Array<number>(n).fill(0);
  let found = 0;

  const dfs = (r: number, usedCols: number, usedRegions: number, prev: number): void => {
    if (r === n) {
      found++;
      if (out) out.push(cols.slice());
      return;
    }
    if (deadBefore[r]! & ~usedRegions) return;
    const base = r * n;
    for (let c = 0; c < n; c++) {
      if (usedCols & (1 << c)) continue;
      if (prev >= 0 && c >= prev - 1 && c <= prev + 1) continue;
      const g = region[base + c]!;
      if (usedRegions & (1 << g)) continue;
      cols[r] = c;
      dfs(r + 1, usedCols | (1 << c), usedRegions | (1 << g), c);
      if (found >= limit) return;
    }
  };
  dfs(0, 0, 0, -10);
  return found;
}

/** The unique solution, or null when there are zero or several. */
export function uniqueSolution(n: number, region: ArrayLike<number>): number[] | null {
  const out: number[][] = [];
  return countSolutions(n, region, 2, out) === 1 ? out[0]! : null;
}
