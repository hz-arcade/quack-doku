import { addDays, DAY_RE, epochDay } from '../../shared/day.ts';
import { LEVEL_COUNT } from '../engine/ladder.ts';
import { defaultStore, readJson, writeJson, type KeyValueStore } from './store.ts';

/**
 * Everything kept on the device. Each blob carries a version; anything that fails
 * validation is dropped field by field rather than wiping the rest. Unlocks, stars and
 * streaks are derived from results, never stored.
 */
export const KEYS = {
  progress: 'quack-doku.progress',
  play: 'quack-doku.play',
  daily: 'quack-doku.daily',
  settings: 'quack-doku.settings',
} as const;

/** Unsolved levels that are always open, so one tough puzzle never blocks the way. */
export const OPEN_AHEAD = 3;
const PLAY_KEEP = 30;
const MS_MAX = 100 * 3_600_000;

export interface LevelResult {
  /** Fastest solve. */
  ms: number;
  /** Fewest hints in any solve. */
  hints: number;
  at: number;
}

export interface DailyResult {
  ms: number;
  hints: number;
  /** Solved on the puzzle's own UTC day (counts for streaks and the leaderboard). */
  onDay: boolean;
  at: number;
}

/** A board in progress. `pid` ties it to the puzzle so a changed puzzle never gets old marks. */
export interface PlayState {
  pid: string;
  marks: string;
  ms: number;
  hints: number;
  /** The daily Start button was pressed. */
  started: boolean;
  at: number;
}

export interface Settings {
  autoX: boolean;
  timer: boolean;
  patterns: boolean;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = { autoX: false, timer: true, patterns: false, haptics: true };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MS_MAX;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function loadLevels(raw: unknown): Record<number, LevelResult> {
  const out: Record<number, LevelResult> = {};
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.levels)) return out;
  for (const [k, r] of Object.entries(raw.levels)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > LEVEL_COUNT || !isObj(r)) continue;
    if (isMs(r.ms) && isCount(r.hints) && isTime(r.at)) out[n] = { ms: r.ms, hints: r.hints, at: r.at };
  }
  return out;
}

function loadDaily(raw: unknown): Record<string, DailyResult> {
  const out: Record<string, DailyResult> = {};
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.results)) return out;
  for (const [d, r] of Object.entries(raw.results)) {
    if (!DAY_RE.test(d) || Number.isNaN(epochDay(d)) || !isObj(r)) continue;
    if (isMs(r.ms) && isCount(r.hints) && typeof r.onDay === 'boolean' && isTime(r.at)) out[d] = { ms: r.ms, hints: r.hints, onDay: r.onDay, at: r.at };
  }
  return out;
}

function loadPlay(raw: unknown): Record<string, PlayState> {
  const out: Record<string, PlayState> = {};
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.boards)) return out;
  for (const [key, p] of Object.entries(raw.boards)) {
    if (!/^(L\d{1,4}|D\d{4}-\d{2}-\d{2})$/.test(key) || !isObj(p)) continue;
    if (typeof p.pid === 'string' && typeof p.marks === 'string' && /^[.xD]{16,100}$/.test(p.marks) && isMs(p.ms) && isCount(p.hints) && typeof p.started === 'boolean' && isTime(p.at)) {
      out[key] = { pid: p.pid, marks: p.marks, ms: p.ms, hints: p.hints, started: p.started, at: p.at };
    }
  }
  return out;
}

function loadSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (!isObj(raw) || raw.v !== 1) return s;
  for (const k of Object.keys(s) as (keyof Settings)[]) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  return s;
}

export interface LevelOutcome {
  first: boolean;
  newBest: boolean;
  /** Best time before this solve (null on the first solve). */
  prevMs: number | null;
}

export class Progress {
  private readonly store: KeyValueStore;
  levels: Record<number, LevelResult>;
  daily: Record<string, DailyResult>;
  private boards: Record<string, PlayState>;
  settings: Settings;

  constructor(store: KeyValueStore = defaultStore()) {
    this.store = store;
    this.levels = loadLevels(readJson(store, KEYS.progress));
    this.daily = loadDaily(readJson(store, KEYS.daily));
    this.boards = loadPlay(readJson(store, KEYS.play));
    this.settings = loadSettings(readJson(store, KEYS.settings));
  }

  // ---- Levels ----

  isSolved(k: number): boolean {
    return this.levels[k] !== undefined;
  }

  solvedCount(): number {
    return Object.keys(this.levels).length;
  }

  /** Solved levels plus the first OPEN_AHEAD unsolved ones. */
  openLevels(): Set<number> {
    const out = new Set<number>();
    let ahead = 0;
    for (let k = 1; k <= LEVEL_COUNT; k++) {
      if (this.isSolved(k)) out.add(k);
      else if (ahead < OPEN_AHEAD) {
        out.add(k);
        ahead++;
      }
    }
    return out;
  }

  isOpen(k: number): boolean {
    return this.openLevels().has(k);
  }

  /** Lowest unsolved level, or null when every level is solved. */
  nextLevel(): number | null {
    for (let k = 1; k <= LEVEL_COUNT; k++) if (!this.isSolved(k)) return k;
    return null;
  }

  /** The next unsolved level after `k` (wrapping to the lowest), or null when all are solved. */
  nextAfter(k: number): number | null {
    for (let j = k + 1; j <= LEVEL_COUNT; j++) if (!this.isSolved(j)) return j;
    return this.nextLevel();
  }

  /** 3 stars without hints, 2 with one or two, 1 otherwise; 0 when unsolved. */
  stars(k: number): number {
    const r = this.levels[k];
    if (!r) return 0;
    return r.hints === 0 ? 3 : r.hints <= 2 ? 2 : 1;
  }

  recordLevel(k: number, ms: number, hints: number, now = Date.now()): LevelOutcome {
    const prev = this.levels[k];
    const rounded = Math.round(ms);
    this.levels[k] = prev
      ? { ms: Math.min(prev.ms, rounded), hints: Math.min(prev.hints, hints), at: now }
      : { ms: rounded, hints, at: now };
    writeJson(this.store, KEYS.progress, { v: 1, levels: this.levels });
    return { first: !prev, newBest: !!prev && rounded < prev.ms, prevMs: prev ? prev.ms : null };
  }

  // ---- Daily ----

  dailyResult(day: string): DailyResult | undefined {
    return this.daily[day];
  }

  recordDaily(day: string, ms: number, hints: number, onDay: boolean, now = Date.now()): void {
    const prev = this.daily[day];
    // The first solve is the one that counts; a replay never overwrites it.
    if (prev) return;
    this.daily[day] = { ms: Math.round(ms), hints, onDay, at: now };
    writeJson(this.store, KEYS.daily, { v: 1, results: this.daily });
  }

  /** Consecutive days solved on the day, ending today (or yesterday while today is open). */
  streak(today: string): number {
    let day = this.daily[today]?.onDay ? today : addDays(today, -1);
    let n = 0;
    while (this.daily[day]?.onDay) {
      n++;
      day = addDays(day, -1);
    }
    return n;
  }

  bestStreak(): number {
    const days = Object.keys(this.daily)
      .filter((d) => this.daily[d]!.onDay)
      .map(epochDay)
      .sort((a, b) => a - b);
    let best = 0;
    let run = 0;
    let prev = -Infinity;
    for (const d of days) {
      run = d === prev + 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    return best;
  }

  // ---- Boards in progress ----

  getPlay(key: string, pid: string): PlayState | null {
    const p = this.boards[key];
    return p && p.pid === pid ? p : null;
  }

  savePlay(key: string, state: Omit<PlayState, 'at'>, now = Date.now()): void {
    this.boards[key] = { ...state, at: now };
    const keys = Object.keys(this.boards);
    if (keys.length > PLAY_KEEP) {
      keys.sort((a, b) => this.boards[a]!.at - this.boards[b]!.at);
      for (const k of keys.slice(0, keys.length - PLAY_KEEP)) delete this.boards[k];
    }
    writeJson(this.store, KEYS.play, { v: 1, boards: this.boards });
  }

  /** Whether a board for `key` is in progress (any puzzle id). */
  hasPlay(key: string): boolean {
    return key in this.boards;
  }

  clearPlay(key: string): void {
    if (!(key in this.boards)) return;
    delete this.boards[key];
    writeJson(this.store, KEYS.play, { v: 1, boards: this.boards });
  }

  /** Key of the most recently touched unsolved level board, for "Continue". */
  lastLevelInPlay(): number | null {
    let best: [number, number] | null = null;
    for (const [key, p] of Object.entries(this.boards)) {
      if (!key.startsWith('L')) continue;
      const k = Number(key.slice(1));
      if (this.isSolved(k) || (!p.marks.includes('x') && !p.marks.includes('D'))) continue;
      if (!best || p.at > best[1]) best = [k, p.at];
    }
    return best ? best[0] : null;
  }

  // ---- Settings ----

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    writeJson(this.store, KEYS.settings, { v: 1, ...this.settings });
  }
}
