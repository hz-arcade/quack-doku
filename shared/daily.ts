import { addDays, epochDay } from './day.ts';

/**
 * Daily puzzles come from a pre-generated pack. If the pack ever runs out, a day reuses the
 * most recent packed day with the same weekday, turned by one of the board's symmetries, so
 * the game and the Worker (which only has the answers) still agree on the puzzle.
 */

export interface DailySource {
  /** Packed day the puzzle comes from. */
  day: string;
  /** Symmetry applied: 0 = none, 1..7 = flips and turns. */
  sym: number;
}

export function dailySource(day: string, first: string, last: string): DailySource | null {
  const d = epochDay(day);
  const f = epochDay(first);
  const l = epochDay(last);
  if (!(d >= f)) return null;
  if (d <= l) return { day, sym: 0 };
  const weeks = Math.ceil((d - l) / 7);
  const src = addDays(day, -7 * weeks);
  if (epochDay(src) < f) return null;
  return { day: src, sym: 1 + (weeks % 7) };
}

/** Map cell (r, c) of an n×n board through symmetry `sym` (bit 4 transposes, 1 flips rows, 2 flips columns). */
export function symCell(n: number, sym: number, r: number, c: number): [number, number] {
  let rr = r;
  let cc = c;
  if (sym & 4) [rr, cc] = [cc, rr];
  if (sym & 1) rr = n - 1 - rr;
  if (sym & 2) cc = n - 1 - cc;
  return [rr, cc];
}

/** Transform a solution (one base-36 column per row). */
export function symSolution(s: string, sym: number): string {
  const n = s.length;
  const cols = new Array<number>(n);
  for (let r = 0; r < n; r++) {
    const [rr, cc] = symCell(n, sym, r, parseInt(s[r]!, 36));
    cols[rr] = cc;
  }
  return cols.map((c) => c.toString(36)).join('');
}

/** Transform a region map (one letter per cell, row-major). */
export function symRegions(n: number, r: string, sym: number): string {
  const out = new Array<string>(n * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const [rr, cc] = symCell(n, sym, row, col);
      out[rr * n + cc] = r[row * n + col]!;
    }
  }
  return out.join('');
}

/** Solution for `day` from the answers string (comma-separated, one per day from `first`). */
export function answerFor(day: string, first: string, answers: string): string | null {
  const list = answers.split(',');
  const last = addDays(first, list.length - 1);
  const src = dailySource(day, first, last);
  if (!src) return null;
  const s = list[epochDay(src.day) - epochDay(first)];
  if (!s) return null;
  return src.sym ? symSolution(s, src.sym) : s;
}
