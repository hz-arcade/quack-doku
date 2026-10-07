import { LIMIT_DEFAULT, type DayBoard, type Entry, type SubmitRequest, type SubmitResponse } from '../../shared/scoreRules.ts';

/**
 * Daily leaderboard API client. Every call resolves to a Result and never throws, so the UI
 * can treat "no network", "server said no" and "feature not configured" as ordinary states.
 */
export type FailureKind = 'disabled' | 'offline' | 'timeout' | 'rate' | 'rejected' | 'server';

export interface Failure {
  ok: false;
  error: FailureKind;
  /** Whether trying the same request again could succeed. */
  retryable: boolean;
  retryAfter?: number;
}

export type Result<T> = { ok: true; data: T } | Failure;

export interface LeaderboardClient {
  readonly enabled: boolean;
  fetchDay(day: string, limit?: number): Promise<Result<DayBoard>>;
  submit(req: SubmitRequest): Promise<Result<SubmitResponse>>;
}

/**
 * Where the scores API lives. Set at build time by the deploy workflow; during `npm run dev`
 * it falls back to a local `npm run scores:dev`. Empty means the feature is off.
 */
export function scoresUrl(): string {
  const env = import.meta.env.VITE_SCORES_URL as string | undefined;
  if (env) return env.replace(/\/+$/, '');
  return import.meta.env.DEV ? 'http://localhost:8795' : '';
}

function fail(error: FailureKind, retryable: boolean, retryAfter?: number): Failure {
  return retryAfter === undefined ? { ok: false, error, retryable } : { ok: false, error, retryable, retryAfter };
}

function isEntry(v: unknown): v is Entry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return Number.isInteger(e.id) && typeof e.name === 'string' && Number.isFinite(e.ms) && Number.isFinite(e.at);
}

export function isDayBoard(v: unknown): v is DayBoard {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return Number.isFinite(b.now) && typeof b.day === 'string' && Number.isFinite(b.total) && Array.isArray(b.top) && b.top.every(isEntry);
}

function isSubmitResponse(v: unknown): v is SubmitResponse {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.ok === true && isEntry(r.entry) && Number.isInteger(r.rank) && isDayBoard(r.board);
}

export function createClient(opts: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }): LeaderboardClient {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 8000;
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));

  async function call<T>(path: string, init: RequestInit, accept: (v: unknown) => v is T): Promise<Result<T>> {
    if (!base) return fail('disabled', false);
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    try {
      const res = await doFetch(`${base}${path}`, { ...init, signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON error page */
      }
      if (res.ok) return accept(body) ? { ok: true, data: body } : fail('server', true);
      if (res.status === 429) {
        const after = Number((body as { retryAfter?: unknown } | null)?.retryAfter ?? res.headers.get('retry-after'));
        return fail('rate', false, Number.isFinite(after) && after > 0 ? after : undefined);
      }
      if (res.status >= 500) return fail('server', true);
      return fail('rejected', false);
    } catch {
      return timedOut ? fail('timeout', true) : fail('offline', true);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    enabled: base !== '',
    fetchDay: (day, limit = LIMIT_DEFAULT) => call(`/daily?day=${encodeURIComponent(day)}&limit=${limit}`, { method: 'GET' }, isDayBoard),
    submit: (req) => call(`/daily`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) }, isSubmitResponse),
  };
}

/* ---------- Things remembered on this device ---------- */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const NAME_KEY = 'quack-doku.name';
const ENTRIES_KEY = 'quack-doku.entries';
const GIDS_KEY = 'quack-doku.gids';
const ENTRIES_KEPT = 50;

function deviceStore(): KeyValueStore | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* storage blocked */
  }
  return null;
}

/** The name used last time, to prefill the field. */
export function loadName(store: KeyValueStore | null = deviceStore()): string {
  try {
    return store?.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string, store: KeyValueStore | null = deviceStore()): void {
  try {
    store?.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

/** Ids of rows this device submitted, so they can be highlighted. The server never learns who is who. */
export function myEntries(store: KeyValueStore | null = deviceStore()): Set<number> {
  try {
    const raw: unknown = JSON.parse(store?.getItem(ENTRIES_KEY) ?? '[]');
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((v): v is number => Number.isInteger(v)));
  } catch {
    return new Set();
  }
}

export function rememberEntry(id: number, store: KeyValueStore | null = deviceStore()): void {
  const ids = [...myEntries(store)].filter((v) => v !== id);
  ids.push(id);
  try {
    store?.setItem(ENTRIES_KEY, JSON.stringify(ids.slice(-ENTRIES_KEPT)));
  } catch {
    /* ignore */
  }
}

/** One stable solve id per day, so a retry after reload is recognised as the same solve. */
export function solveId(day: string, store: KeyValueStore | null = deviceStore()): string {
  let map: Record<string, string> = {};
  try {
    const raw: unknown = JSON.parse(store?.getItem(GIDS_KEY) ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) map = raw as Record<string, string>;
  } catch {
    /* ignore */
  }
  const found = map[day];
  if (typeof found === 'string' && /^[0-9a-f-]{36}$/.test(found)) return found;
  const id = newGameId();
  const days = Object.keys(map).sort().slice(-13);
  const next: Record<string, string> = {};
  for (const d of days) next[d] = map[d]!;
  next[day] = id;
  try {
    store?.setItem(GIDS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return id;
}

/** Random id for one solve. `crypto.randomUUID` is missing on plain-http pages, hence the fallback. */
export function newGameId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
