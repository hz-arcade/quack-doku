import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeSlot, levelSeed, dailySeed } from '../scripts/puzzles.ts';
import { answerFor, dailySource, symRegions, symSolution } from '../shared/daily.ts';
import { DAILY_ANSWERS, DAILY_FIRST, DAILY_LAST } from '../shared/dailyAnswers.ts';
import { addDays, dailySize, dayKey, epochDay, LAUNCH_DAY, weekday } from '../shared/day.ts';
import { uniqueSolution } from '../src/engine/count.ts';
import { grade } from '../src/engine/difficulty.ts';
import type { Target } from '../src/engine/generate.ts';
import { makeGeo } from '../src/engine/grid.ts';
import { dailyTarget, LEVEL_COUNT, levelSize, levelTarget } from '../src/engine/ladder.ts';
import { TIER } from '../src/engine/logic.ts';
import { parseRegions, parseSolution, puzzleId, structureProblems, type PackPuzzle } from '../src/engine/puzzle.ts';

const root = new URL('../puzzles/', import.meta.url);
const levels = (JSON.parse(readFileSync(new URL('levels.json', root), 'utf8')) as { levels: PackPuzzle[] }).levels;
const monthFiles = readdirSync(new URL('daily/', root)).filter((f) => f.endsWith('.json')).sort();
const daily = new Map<string, PackPuzzle>();
for (const f of monthFiles) {
  const m = JSON.parse(readFileSync(new URL(`daily/${f}`, root), 'utf8')) as { v: number; month: string; days: Record<string, PackPuzzle> };
  expect(m.v).toBe(1);
  expect(`${m.month}.json`).toBe(f);
  for (const [d, p] of Object.entries(m.days)) daily.set(d, p);
}
const days = [...daily.keys()].sort();
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as {
  levels: { count: number; sha256: string };
  daily: { first: string; last: string; months: Record<string, string> };
};

/** Everything a stored puzzle promises, checked from scratch. */
function verify(p: PackPuzzle, t: Target, label: string): void {
  const region = parseRegions(p.n, p.r);
  expect(p.n, label).toBe(t.n);
  expect(structureProblems(p.n, region), label).toEqual([]);
  expect(uniqueSolution(p.n, region), label).toEqual(parseSolution(p.n, p.s));
  expect(puzzleId(p.n, region), label).toBe(p.id);
  const g = grade(makeGeo(p.n, region), { maxTier: t.maxTier, maxChain: t.maxChain });
  expect(g.solved, label).toBe(true);
  expect(g.score, label).toBe(p.d);
  expect(g.tier, label).toBe(p.t);
  expect(g.whatifs, label).toBe(p.w);
  expect(p.t, label).toBeLessThanOrEqual(t.maxTier);
  expect(p.w, label).toBeLessThanOrEqual(t.maxWhatifs);
  expect(p.d, label).toBeGreaterThanOrEqual(t.lo);
  expect(p.d, label).toBeLessThanOrEqual(t.hi);
}

describe('level pack', () => {
  it(`has ${LEVEL_COUNT} levels, each unique, logic-solvable and inside its band`, () => {
    expect(levels).toHaveLength(LEVEL_COUNT);
    levels.forEach((p, i) => verify(p, levelTarget(i + 1), `level ${i + 1}`));
  });

  it('starts with singles-only tutorials and grows from 5×5 to 10×10', () => {
    for (let k = 1; k <= 3; k++) expect(levels[k - 1]!.t).toBeLessThanOrEqual(TIER.single);
    for (let k = 1; k <= LEVEL_COUNT; k++) expect(levels[k - 1]!.n).toBe(levelSize(k));
    expect(levels[0]!.n).toBe(5);
    expect(levels[LEVEL_COUNT - 1]!.n).toBe(10);
  });

  it('gets harder through each size', () => {
    for (let n = 5; n <= 10; n++) {
      const scores = levels.filter((p) => p.n === n).map((p) => p.d);
      const third = Math.floor(scores.length / 3);
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(avg(scores.slice(-third)), `${n}×${n}`).toBeGreaterThan(avg(scores.slice(0, third)));
    }
  });
});

describe('daily pack', () => {
  it('covers every UTC day from launch without gaps, sized by weekday', () => {
    expect(days[0]).toBe(LAUNCH_DAY);
    days.forEach((d, i) => {
      expect(d).toBe(addDays(LAUNCH_DAY, i));
      expect(daily.get(d)!.n).toBe(dailySize(d));
    });
  });

  it('every daily is unique, logic-solvable and inside its band', () => {
    for (const d of days) verify(daily.get(d)!, dailyTarget(weekday(d), dailySize(d)), d);
  });

  it('runs well into the future', () => {
    const left = epochDay(days[days.length - 1]!) - epochDay(dayKey(Date.now()));
    if (left < 180) console.warn(`Only ${left} days of Daily Ducks left: run node scripts/puzzles.ts --daily-until <day>`);
    expect(left).toBeGreaterThanOrEqual(60);
  });

  it('answers file matches the pack (the Worker relies on it)', () => {
    expect(DAILY_FIRST).toBe(days[0]);
    expect(DAILY_LAST).toBe(days[days.length - 1]);
    expect(DAILY_ANSWERS).toBe(days.map((d) => daily.get(d)!.s).join(','));
  });

  it('recycles a past day, turned, once the pack runs out', () => {
    const after = addDays(DAILY_LAST, 10);
    const src = dailySource(after, DAILY_FIRST, DAILY_LAST)!;
    expect(src.sym).toBeGreaterThan(0);
    expect(weekday(src.day)).toBe(weekday(after));
    const p = daily.get(src.day)!;
    const r = symRegions(p.n, p.r, src.sym);
    const s = symSolution(p.s, src.sym);
    expect(uniqueSolution(p.n, parseRegions(p.n, r))).toEqual(parseSolution(p.n, s));
    expect(answerFor(after, DAILY_FIRST, DAILY_ANSWERS)).toBe(s);
    expect(answerFor(addDays(LAUNCH_DAY, -1), DAILY_FIRST, DAILY_ANSWERS)).toBeNull();
  });
});

describe('both packs', () => {
  it('never repeat a puzzle (up to symmetry and colouring)', () => {
    const ids = [...levels.map((p) => p.id), ...days.map((d) => daily.get(d)!.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('match the manifest hashes', () => {
    const sha = (u: URL) => createHash('sha256').update(readFileSync(u)).digest('hex');
    expect(manifest.levels.count).toBe(LEVEL_COUNT);
    expect(manifest.levels.sha256).toBe(sha(new URL('levels.json', root)));
    expect(manifest.daily.first).toBe(days[0]);
    expect(manifest.daily.last).toBe(days[days.length - 1]);
    for (const f of monthFiles) expect(manifest.daily.months[f.replace('.json', '')], f).toBe(sha(new URL(`daily/${f}`, root)));
  });

  it('regenerate identically from their seeds (the generator has not drifted)', () => {
    for (const k of [1, 2, 37, 150, 333]) expect(makeSlot(levelTarget(k), levelSeed(k), new Set()), `level ${k}`).toEqual(levels[k - 1]);
    for (const d of [days[0]!, days[5]!, days[100]!]) expect(makeSlot(dailyTarget(weekday(d), dailySize(d)), dailySeed(d), new Set()), d).toEqual(daily.get(d));
  });
});
