/**
 * UTC calendar days for the Daily Duck. Shared by the game, the Worker, the pack generator
 * and the tests. Pure TypeScript, no imports, so every side compiles it as-is.
 */
export const DAY_MS = 86_400_000;

/** The first Daily Duck (puzzle #1). */
export const LAUNCH_DAY = '2026-10-07';

/** Board size by weekday, Monday first: gentle early in the week, biggest on Sunday. */
export const DAILY_SIZES: readonly number[] = [7, 7, 8, 8, 9, 9, 10];

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' of the UTC day containing `ms`. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Days since 1970-01-01, or NaN for a malformed key. */
export function epochDay(day: string): number {
  if (!DAY_RE.test(day)) return NaN;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  // Reject impossible dates such as 2026-02-31 that Date.UTC would roll over.
  if (dayKey(ms) !== day) return NaN;
  return ms / DAY_MS;
}

export function dayStart(day: string): number {
  return epochDay(day) * DAY_MS;
}

export function addDays(day: string, k: number): string {
  return dayKey(dayStart(day) + k * DAY_MS);
}

/** 0 = Monday … 6 = Sunday. 1970-01-01 was a Thursday. */
export function weekday(day: string): number {
  return (epochDay(day) + 3) % 7;
}

export function dailySize(day: string): number {
  return DAILY_SIZES[weekday(day)]!;
}

/** Puzzle number shown to players: #1 on launch day. */
export function dailyNumber(day: string): number {
  return epochDay(day) - epochDay(LAUNCH_DAY) + 1;
}

/** Milliseconds until the next UTC midnight. */
export function msUntilNextDay(now: number): number {
  return DAY_MS - (now % DAY_MS);
}
