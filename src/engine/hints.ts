import { CAND, DUCK, X, type Geo } from './grid.ts';
import { DEFAULT_MAX_CHAIN, findClears, nextStep, type Step } from './logic.ts';

export type Hint =
  /** Marks that contradict the solution. `cells` is empty until the player asks again. */
  | { kind: 'mistakes'; count: number; cells: number[] }
  | { kind: 'step'; step: Step }
  | { kind: 'done' };

export interface HintInput {
  geo: Geo;
  /** Column of the duck in each row. */
  solution: readonly number[];
  /** The player's own marks (CAND = empty, X, DUCK). */
  marks: Uint8Array;
  /** Whether cells seen by a duck count as crossed out automatically. */
  autoX: boolean;
  /** Second press after a mistakes hint: show which marks are wrong. */
  revealMistakes?: boolean;
  /** Most recently placed duck, preferred when several ducks still need clearing. */
  lastDuck?: number;
}

export function isSolutionCell(geo: Geo, solution: readonly number[], cell: number): boolean {
  return solution[Math.floor(cell / geo.n)] === cell % geo.n;
}

/** Ducks off the solution and crosses on it. */
export function mistakes(geo: Geo, solution: readonly number[], marks: Uint8Array): number[] {
  const out: number[] = [];
  for (let c = 0; c < geo.size; c++) {
    const sol = isSolutionCell(geo, solution, c);
    if ((marks[c] === DUCK && !sol) || (marks[c] === X && sol)) out.push(c);
  }
  return out;
}

/** The marks the logic engine works from: the player's, plus automatic crosses when enabled. */
export function effectiveMarks(geo: Geo, marks: Uint8Array, autoX: boolean): Uint8Array {
  const m = marks.slice();
  if (!autoX) return m;
  for (let c = 0; c < geo.size; c++) {
    if (marks[c] !== DUCK) continue;
    for (const s of geo.sees[c]!) if (m[s] === CAND) m[s] = X;
  }
  return m;
}

/**
 * Next hint: mistakes first (so a hint never builds on a wrong mark), then crossing out
 * around a placed duck, then the easiest deduction from every tier. Every technique only
 * removes candidates, so from any board without mistakes a deduction always exists for a
 * puzzle the grader solved.
 */
export function buildHint(input: HintInput): Hint {
  const { geo, solution, marks } = input;
  const wrong = mistakes(geo, solution, marks);
  if (wrong.length) return { kind: 'mistakes', count: wrong.length, cells: input.revealMistakes ? wrong : [] };
  let ducks = 0;
  for (let c = 0; c < geo.size; c++) if (marks[c] === DUCK) ducks++;
  if (ducks === geo.n) return { kind: 'done' };
  const m = effectiveMarks(geo, marks, input.autoX);
  const clears = findClears(geo, m);
  if (clears.length) {
    const preferred = clears.find((d) => d.tech === 'clear' && d.duck === input.lastDuck) ?? clears[clears.length - 1]!;
    return { kind: 'step', step: { d: preferred, tier: 0, options: clears.length } };
  }
  const s = nextStep(geo, m, { maxChain: DEFAULT_MAX_CHAIN * 2 });
  if (s === null || s === 'contradiction') {
    // Unreachable for a well-formed puzzle without mistakes; fall back to revealing a duck.
    const r = solution.findIndex((col, row) => m[row * geo.n + col] !== DUCK);
    const place = r * geo.n + solution[r]!;
    return { kind: 'step', step: { d: { tech: 'single', unit: r, place }, tier: 1, options: 1 } };
  }
  return { kind: 'step', step: s };
}
