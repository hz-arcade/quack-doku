import { describe, expect, it } from 'vitest';
import { countSolutions, uniqueSolution } from '../src/engine/count.ts';
import { grade } from '../src/engine/difficulty.ts';
import { generate, moveCell } from '../src/engine/generate.ts';
import { CAND, DUCK, makeGeo, X } from '../src/engine/grid.ts';
import { applyDeduction, countDucks, findBlocks, findConfines, findPigeons, findSingles, nextStep, TIER } from '../src/engine/logic.ts';
import { canonicalForm, isSolution, parseRegions, parseSolution, puzzleId, structureProblems } from '../src/engine/puzzle.ts';
import { Rng } from '../src/engine/rng.ts';

const rowsAsRegions = (n: number) => Uint8Array.from({ length: n * n }, (_, c) => Math.floor(c / n));

describe('solution counter', () => {
  it('counts every no-touching permutation when regions are the rows', () => {
    const known = [2, 14, 90, 646, 5242, 47622, 479306];
    for (let n = 4; n <= 10; n++) expect(countSolutions(n, rowsAsRegions(n), 1e9), `n=${n}`).toBe(known[n - 4]);
  });

  it('finds the single solution of a unique puzzle and stops at the limit', () => {
    const n = 5;
    const region = parseRegions(n, 'aaaeeacceeacceeadcceabbbb');
    expect(uniqueSolution(n, region)).toEqual(parseSolution(n, '02413'));
    expect(countSolutions(n, rowsAsRegions(n), 3)).toBe(3);
  });

  it('reports zero for an impossible map', () => {
    // Two regions confined to the same single row cannot both get a duck.
    const n = 4;
    const region = parseRegions(n, 'abccdddcdddcdddc');
    expect(structureProblems(n, region)).toEqual([]);
    expect(countSolutions(n, region, 10)).toBe(0);
  });
});

describe('puzzle format', () => {
  it('detects broken region maps', () => {
    expect(structureProblems(4, parseRegions(4, 'aabbaabbccddccdd'))).toEqual([]);
    expect(structureProblems(4, parseRegions(4, 'abababababababcd'))).toContain('region 0 not connected');
    expect(structureProblems(4, parseRegions(4, 'aaaaaaaaaaaaaaab'))).toContain('region 2 empty');
  });

  it('checks solutions against every rule', () => {
    const region = parseRegions(5, 'aaaeeacceeacceeadcceabbbb');
    expect(isSolution(5, region, [0, 2, 4, 1, 3])).toBe(true);
    expect(isSolution(5, region, [0, 1, 4, 2, 3])).toBe(false); // touching
    expect(isSolution(5, region, [0, 2, 4, 1, 1])).toBe(false); // same column
  });

  it('gives the same id to rotations, reflections and recolourings', () => {
    const n = 5;
    const r = 'aaaeeacceeacceeadcceabbbb';
    const region = parseRegions(n, r);
    const rotated = new Uint8Array(n * n);
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) rotated[col * n + (n - 1 - row)] = region[row * n + col]!;
    const recoloured = region.map((g) => (g + 2) % n);
    expect(canonicalForm(n, rotated)).toBe(canonicalForm(n, region));
    expect(puzzleId(n, recoloured)).toBe(puzzleId(n, region));
    expect(puzzleId(n, parseRegions(n, 'eedddeeeddbeeddcaaaaccaaa'))).not.toBe(puzzleId(n, region));
  });
});

/** Marks with the given cells crossed out. */
function marksWith(n: number, crossed: number[] = [], ducks: number[] = []): Uint8Array {
  const m = new Uint8Array(n * n);
  for (const c of crossed) m[c] = X;
  for (const c of ducks) m[c] = DUCK;
  return m;
}

describe('techniques', () => {
  // 5×5, regions: a = top row, b = left column below it, c/d/e fill the rest.
  const n = 5;
  const geo = makeGeo(n, parseRegions(n, 'aaaaabcccdbccddbceedbeeed'));

  it('single: a unit with one free cell', () => {
    // Cross out all of row 0 but its last cell.
    const m = marksWith(n, [0, 1, 2, 3]);
    const s = findSingles(geo, m);
    expect(s[0]).toEqual({ tech: 'single', unit: 2 * n + 0, place: 4 });
  });

  it('confine: a region inside one row clears the rest of that row', () => {
    // Region a is row 0, so nothing to clear there; region b lives in column 0 → rest of column 0 goes.
    const m = marksWith(n);
    const found = findConfines(geo, m);
    const b = found.find((d) => d.tech === 'confine' && d.unit === 2 * n + 1);
    expect(b).toEqual({ tech: 'confine', unit: 2 * n + 1, into: n + 0, elim: [0] });
  });

  it('block: cells seen by every candidate of a unit', () => {
    // Leave row 4 with two free cells side by side: the cells above both are out.
    const m = marksWith(n, [20, 21, 22]);
    const found = findBlocks(geo, m);
    const row4 = found.find((d) => d.tech === 'block' && d.unit === 4);
    // Both free cells touch the two cells right above them, and (2,3) shares a column with
    // one and a region with the other.
    expect(row4?.tech === 'block' && row4.elim.sort((a, b) => a - b)).toEqual([13, 18, 19]);
  });

  it('pigeon: two regions confined to two rows clear the rest of those rows', () => {
    // 5×5 with regions a and b each split across rows 0 and 1 only.
    const g = makeGeo(5, parseRegions(5, 'aabbcaabbccccccddddceeee'.padEnd(25, 'e')));
    const m = new Uint8Array(25);
    const found = findPigeons(g, m);
    const hit = found.find((d) => d.tech === 'pigeon' && d.units.length === 2 && d.units.every((u) => u >= 10));
    expect(hit).toBeDefined();
    if (hit?.tech === 'pigeon') {
      expect(hit.into).toEqual([0, 1]);
      expect(hit.elim.sort((a, b) => a - b)).toEqual([4, 9]);
    }
  });

  it('never contradicts the solution, and never gets stuck on a correct board', () => {
    const rng = new Rng(4242);
    let steps = 0;
    for (let n2 = 5; n2 <= 9; n2++) {
      for (let i = 0; i < 6; i++) {
        const p = generate({ n: n2, maxTier: TIER.whatif, maxChain: 4, maxWhatifs: 3, lo: 0, hi: 1e9, climb: 60 }, 1000 * n2 + i);
        expect(p).not.toBeNull();
        if (!p) continue;
        const g = makeGeo(n2, parseRegions(n2, p.r));
        const sol = parseSolution(n2, p.s);
        const isSol = (c: number) => sol[Math.floor(c / n2)] === c % n2;
        for (let trial = 0; trial < 3; trial++) {
          const m = new Uint8Array(n2 * n2);
          for (let c = 0; c < m.length; c++) if (!isSol(c) && rng.chance(0.3 * trial)) m[c] = X;
          while (countDucks(m) < n2) {
            const s = nextStep(g, m);
            expect(s, p.r).not.toBeNull();
            expect(s).not.toBe('contradiction');
            if (!s || s === 'contradiction') break;
            if (s.d.tech === 'single') expect(isSol(s.d.place)).toBe(true);
            else for (const c of s.d.elim) expect(isSol(c), `${s.d.tech} removed a solution cell`).toBe(false);
            applyDeduction(g, m, s.d);
            steps++;
          }
          for (let c = 0; c < m.length; c++) expect(m[c] === DUCK).toBe(isSol(c));
        }
      }
    }
    expect(steps).toBeGreaterThan(200);
  });
});

describe('generator', () => {
  it('is deterministic for a seed', () => {
    const t = { n: 7, maxTier: TIER.pigeon, maxChain: 0, maxWhatifs: 0, lo: 15, hi: 30 };
    expect(generate(t, 99)).toEqual(generate(t, 99));
    expect(generate(t, 99)?.r).not.toBe(generate(t, 100)?.r);
  });

  it('produces unique, well-formed puzzles inside the band and under the tier cap', () => {
    for (const [n, maxTier, lo, hi] of [
      [5, TIER.single, 0, 8],
      [6, TIER.pigeon, 14, 30],
      [8, TIER.whatif, 30, 60],
    ] as const) {
      const p = generate({ n, maxTier, maxChain: 3, maxWhatifs: 2, lo, hi }, 7 + n);
      expect(p, `n=${n}`).not.toBeNull();
      if (!p) continue;
      const region = parseRegions(n, p.r);
      expect(structureProblems(n, region)).toEqual([]);
      expect(uniqueSolution(n, region)).toEqual(parseSolution(n, p.s));
      expect(p.d).toBeGreaterThanOrEqual(lo);
      expect(p.d).toBeLessThanOrEqual(hi);
      expect(p.t).toBeLessThanOrEqual(maxTier);
      const g = grade(makeGeo(n, region), { maxTier, maxChain: 3 });
      expect(g.solved).toBe(true);
      expect(g.score).toBe(p.d);
    }
  });

  it('moving a cell carries along whatever it cut off', () => {
    // Region a: a column of three; moving the middle cell into b strands the bottom cell.
    const n = 4;
    const region = parseRegions(n, 'abccabccabddbbdd');
    const planted = [0, 1, 2, 11];
    const res = moveCell(n, region, planted, 4, 1);
    expect(res?.moved).toBe(2);
    expect(Array.from(res!.region.slice(0, 12))).toEqual([0, 1, 2, 2, 1, 1, 2, 2, 1, 1, 3, 3]);
    expect(moveCell(n, region, planted, 0, 1)).toBeNull();
  });

  it('marks stay CAND/X/DUCK only', () => {
    expect([CAND, X, DUCK]).toEqual([0, 1, 2]);
  });
});
