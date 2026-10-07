/**
 * Daily Duck leaderboard rules, shared by the Worker, the game client and the tests. Pure
 * TypeScript with no DOM or Workers APIs, so both sides compile it as-is.
 *
 * A submission names the day and carries the solution the player found. The Worker checks
 * it against the generated answers file (shared/dailyAnswers.ts), so it never needs the
 * puzzles themselves. Times are measured by the client: impossible ones are rejected, but a
 * possible time cannot be proven genuine.
 */
import { answerFor } from './daily.ts';
import { DAILY_ANSWERS, DAILY_FIRST } from './dailyAnswers.ts';
import { DAY_MS, DAY_RE, dayKey, dayStart, epochDay } from './day.ts';

export const API_VERSION = 1;
export const NAME_MAX = 16;
/** Longest time accepted: 6 hours. */
export const MS_MAX = 6 * 3_600_000;
export const LIMIT_DEFAULT = 20;
export const LIMIT_MAX = 50;
export const BODY_MAX_BYTES = 1024;
/** Clock skew tolerated around UTC midnight, both ways. */
export const SKEW_MS = 2 * 3_600_000;
/** Days back (including today) whose boards can be read. */
export const READABLE_DAYS = 7;

/** Fastest believable solve: 300 ms per duck (placing them by double-tap alone takes that). */
export function msFloor(n: number): number {
  return n * 300;
}

export interface Entry {
  id: number;
  name: string;
  ms: number;
  /** Server time of submission, epoch ms. */
  at: number;
}

export interface DayBoard {
  now: number;
  day: string;
  /** Rows for this day, including those beyond `top`. */
  total: number;
  top: Entry[];
}

export interface SubmitRequest {
  v: number;
  /** Client-generated id of the solve; makes retries and double clicks idempotent. */
  gid: string;
  day: string;
  name: string;
  ms: number;
  /** The solution found: one base-36 column per row. */
  cols: string;
}

export interface SubmitResponse {
  ok: true;
  /** True when this solve had already been submitted; `entry` is the stored row. */
  duplicate: boolean;
  entry: Entry;
  rank: number;
  board: DayBoard;
}

export type ErrorCode = 'bad-json' | 'invalid' | 'origin' | 'too-large' | 'day' | 'wrong' | 'too-fast' | 'rate' | 'busy' | 'not-found' | 'server';

export interface ErrorResponse {
  ok: false;
  error: ErrorCode;
  field?: string;
  /** Seconds until another attempt may succeed (rate limiting). */
  retryAfter?: number;
}

/**
 * Clean a player-typed name for public display. Keeps letters of any script and emoji;
 * removes control characters, invisible formatting (zero-width, bidi overrides), private-use
 * and unpaired surrogates; limits stacked combining marks; collapses whitespace.
 * Returns '' when nothing usable is left.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, 256).normalize('NFC');
  // Invisible formatting goes first: JavaScript counts U+FEFF as whitespace, and it must
  // vanish rather than turn into a visible space.
  s = s.replace(/[\p{Cf}\p{Co}\p{Cs}\p{Cn}]/gu, '');
  s = s.replace(/[\p{Zl}\p{Zp}\s]+/gu, ' ');
  s = s.replace(/\p{Cc}/gu, '');
  s = s.replace(/(\p{M}{2})\p{M}+/gu, '$1');
  s = s.replace(/^[\p{M}\s]+/u, '');
  s = s.replace(/ {2,}/g, ' ').trim();
  s = Array.from(s).slice(0, NAME_MAX).join('').trim();
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = /^[0-9a-z]{4,10}$/;

function int(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function validDay(v: unknown): v is string {
  return typeof v === 'string' && DAY_RE.test(v) && !Number.isNaN(epochDay(v));
}

export type Validation = { ok: true; value: SubmitRequest } | { ok: false; field: string };

/** Shape and range check of a submission. On success the name is already sanitised. */
export function validateSubmission(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, field: 'body' };
  const b = body as Record<string, unknown>;
  if (b.v !== API_VERSION) return { ok: false, field: 'v' };
  if (typeof b.gid !== 'string' || !UUID.test(b.gid)) return { ok: false, field: 'gid' };
  if (!validDay(b.day)) return { ok: false, field: 'day' };
  const name = sanitizeName(b.name);
  if (!name) return { ok: false, field: 'name' };
  if (!int(b.ms, 1, MS_MAX)) return { ok: false, field: 'ms' };
  if (typeof b.cols !== 'string' || !COLS.test(b.cols)) return { ok: false, field: 'cols' };
  return { ok: true, value: { v: API_VERSION, gid: b.gid.toLowerCase(), day: b.day, name, ms: b.ms, cols: b.cols } };
}

/** Whether a solve of `day` may be submitted at server time `now` (its UTC day, with skew). */
export function dayWindowOk(day: string, now: number): boolean {
  const start = dayStart(day);
  if (Number.isNaN(start)) return false;
  return now >= start - SKEW_MS && now < start + DAY_MS + SKEW_MS;
}

/** Whether the board of `day` can be read at `now`: the last READABLE_DAYS days (and tomorrow near midnight). */
export function dayReadable(day: string, now: number): boolean {
  const start = dayStart(day);
  if (Number.isNaN(start)) return false;
  const today = dayStart(dayKey(now));
  return start <= now + SKEW_MS && start > today - READABLE_DAYS * DAY_MS;
}

/** The first rule a submission breaks, or null when it may be stored. */
export function checkDaily(req: Pick<SubmitRequest, 'day' | 'ms' | 'cols'>, now: number, answers = DAILY_ANSWERS, first = DAILY_FIRST): 'day' | 'wrong' | 'too-fast' | null {
  if (!dayWindowOk(req.day, now)) return 'day';
  const answer = answerFor(req.day, first, answers);
  if (!answer || answer !== req.cols) return 'wrong';
  if (req.ms < msFloor(req.cols.length)) return 'too-fast';
  return null;
}

export function clampLimit(raw: string | null): number {
  const n = raw === null ? LIMIT_DEFAULT : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(1, n));
}
