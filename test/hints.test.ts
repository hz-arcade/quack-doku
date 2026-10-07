import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAND, DUCK, makeGeo, X, type Geo } from '../src/engine/grid.ts';
import { buildHint, effectiveMarks, isSolutionCell } from '../src/engine/hints.ts';
import { parseRegions, parseSolution, type PackPuzzle } from '../src/engine/puzzle.ts';
import { Rng } from '../src/engine/rng.ts';

const root = new URL('../puzzles/', import.meta.url);
const puzzles: PackPuzzle[] = [
  ...(JSON.parse(readFileSync(new URL('levels.json', root), 'utf8')) as { levels: PackPuzzle[] }).levels,
  ...readdirSync(new URL('daily/', root))
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => Object.values((JSON.parse(readFileSync(new URL(`daily/${f}`, root), 'utf8')) as { days: Record<string, PackPuzzle> }).days)),
];

/** What "Show me" does: a duck for a single, crosses for everything else. */
function apply(geo: Geo, marks: Uint8Array, h: ReturnType<typeof buildHint>): void {
  if (h.kind !== 'step') return;
  const d = h.step.d;
  if (d.tech === 'single') marks[d.place] = DUCK;
  else for (const c of d.elim) if (marks[c] === CAND) marks[c] = X;
  void geo;
}

/** Follow hints from `start` to the end; returns how many were needed. */
function replay(geo: Geo, solution: number[], start: Uint8Array, autoX: boolean, label: string): number {
  const marks = start.slice();
  for (let i = 0; i < geo.size * 3; i++) {
    const h = buildHint({ geo, solution, marks, autoX });
    if (h.kind === 'done') return i;
    expect(h.kind, label).toBe('step');
    if (h.kind !== 'step') return i;
    const d = h.step.d;
    if (d.tech === 'single') expect(isSolutionCell(geo, solution, d.place), label).toBe(true);
    else {
      expect(d.elim.length, label).toBeGreaterThan(0);
      const m = effectiveMarks(geo, marks, autoX);
      for (const c of d.elim) {
        expect(isSolutionCell(geo, solution, c), `${label}: ${d.tech} crossed the answer`).toBe(false);
        expect(m[c], `${label}: ${d.tech} repeated a cross`).toBe(CAND);
      }
    }
    apply(geo, marks, h);
  }
  throw new Error(`${label}: hints did not finish`);
}

describe('hints', () => {
  it('lead from an empty board to the solution on every packed puzzle', () => {
    let total = 0;
    puzzles.forEach((p, i) => {
      const geo = makeGeo(p.n, parseRegions(p.n, p.r));
      total += replay(geo, parseSolution(p.n, p.s), new Uint8Array(p.n * p.n), i % 2 === 1, `#${i} ${p.id}`);
    });
    expect(total).toBeGreaterThan(puzzles.length * 5);
  });

  it('carry on from boards the player has already worked on', () => {
    const rng = new Rng(77);
    for (let i = 0; i < puzzles.length; i += 7) {
      const p = puzzles[i]!;
      const geo = makeGeo(p.n, parseRegions(p.n, p.r));
      const sol = parseSolution(p.n, p.s);
      const marks = new Uint8Array(p.n * p.n);
      for (let c = 0; c < marks.length; c++) {
        if (isSolutionCell(geo, sol, c)) {
          if (rng.chance(0.3)) marks[c] = DUCK;
        } else if (rng.chance(0.35)) marks[c] = X;
      }
      replay(geo, sol, marks, rng.chance(0.5), `partial #${i}`);
    }
  });

  it('point out mistakes before anything else, first as a count and then as cells', () => {
    const p = puzzles[50]!;
    const geo = makeGeo(p.n, parseRegions(p.n, p.r));
    const sol = parseSolution(p.n, p.s);
    const marks = new Uint8Array(p.n * p.n);
    const wrongDuck = (sol[0]! + 2) % p.n;
    marks[wrongDuck] = DUCK;
    const answer = p.n + sol[1]!;
    marks[answer] = X;
    const first = buildHint({ geo, solution: sol, marks, autoX: false });
    expect(first).toEqual({ kind: 'mistakes', count: 2, cells: [] });
    const second = buildHint({ geo, solution: sol, marks, autoX: true, revealMistakes: true });
    expect(second.kind === 'mistakes' && second.cells.sort((a, b) => a - b)).toEqual([wrongDuck, answer].sort((a, b) => a - b));
  });

  it('asks to cross out around a fresh duck when auto-cross is off, and skips that when it is on', () => {
    const p = puzzles[10]!;
    const geo = makeGeo(p.n, parseRegions(p.n, p.r));
    const sol = parseSolution(p.n, p.s);
    const marks = new Uint8Array(p.n * p.n);
    const duck = 2 * p.n + sol[2]!;
    marks[duck] = DUCK;
    const off = buildHint({ geo, solution: sol, marks, autoX: false, lastDuck: duck });
    expect(off.kind === 'step' && off.step.d.tech).toBe('clear');
    const on = buildHint({ geo, solution: sol, marks, autoX: true, lastDuck: duck });
    expect(on.kind === 'step' && on.step.d.tech).not.toBe('clear');
  });

  it('says done on a solved board', () => {
    const p = puzzles[0]!;
    const geo = makeGeo(p.n, parseRegions(p.n, p.r));
    const sol = parseSolution(p.n, p.s);
    const marks = new Uint8Array(p.n * p.n);
    sol.forEach((c, r) => (marks[r * p.n + c] = DUCK));
    expect(buildHint({ geo, solution: sol, marks, autoX: false })).toEqual({ kind: 'done' });
  });
});
