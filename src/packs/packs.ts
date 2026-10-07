import { dailySource, symRegions, symSolution } from '../../shared/daily.ts';
import { DAILY_FIRST, DAILY_LAST } from '../../shared/dailyAnswers.ts';
import type { PackPuzzle } from '../engine/puzzle.ts';

/**
 * Puzzle packs, loaded on demand: the level pack is one chunk, the dailies one chunk per
 * month. The service worker precaches them all, so everything works offline after the
 * first visit.
 */
let levelsPromise: Promise<readonly PackPuzzle[]> | null = null;

export function loadLevels(): Promise<readonly PackPuzzle[]> {
  levelsPromise ??= import('../../puzzles/levels.json').then((m) => (m.default as { levels: PackPuzzle[] }).levels);
  // A failed load (offline before the first visit finished) may be retried later.
  levelsPromise.catch(() => {
    levelsPromise = null;
  });
  return levelsPromise;
}

export async function getLevel(k: number): Promise<PackPuzzle> {
  const levels = await loadLevels();
  const p = levels[k - 1];
  if (!p) throw new Error(`no level ${k}`);
  return p;
}

const months = import.meta.glob<{ default: { days: Record<string, PackPuzzle> } }>('../../puzzles/daily/*.json');

export interface DailyPuzzle extends PackPuzzle {
  /** Identifies the puzzle for saved boards (includes the symmetry for recycled days). */
  pid: string;
}

export function dailyAvailable(day: string): boolean {
  return dailySource(day, DAILY_FIRST, DAILY_LAST) !== null;
}

export async function getDaily(day: string): Promise<DailyPuzzle> {
  const src = dailySource(day, DAILY_FIRST, DAILY_LAST);
  if (!src) throw new Error(`no daily for ${day}`);
  const load = months[`../../puzzles/daily/${src.day.slice(0, 7)}.json`];
  if (!load) throw new Error(`no daily month for ${src.day}`);
  const p = (await load()).default.days[src.day];
  if (!p) throw new Error(`no daily for ${src.day}`);
  if (!src.sym) return { ...p, pid: p.id };
  return { ...p, r: symRegions(p.n, p.r, src.sym), s: symSolution(p.s, src.sym), pid: `${p.id}.${src.sym}` };
}
