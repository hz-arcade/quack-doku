/**
 * Quack-doku Daily Duck leaderboard: a Worker in front of one SQLite-backed Durable Object.
 *
 *   GET    /daily?day=YYYY-MM-DD&limit=20  → DayBoard (fastest solves of that day)
 *   POST   /daily                          → SubmitResponse (saved entry, rank, fresh board)
 *   DELETE /daily/:id                      → admin only; needs the ADMIN_TOKEN secret
 *   GET    /healthz
 *
 * Validation lives in shared/scoreRules.ts so the client and the tests use the very same
 * code. A submission must carry the day's solution and arrive on that UTC day; times are
 * measured by the client, so a possible time cannot be proven genuine.
 */
import { DurableObject } from 'cloudflare:workers';
import { DAY_MS, dayKey, epochDay } from '../../shared/day.ts';
import {
  BODY_MAX_BYTES,
  checkDaily,
  clampLimit,
  dayReadable,
  validateSubmission,
  validDay,
  type DayBoard,
  type Entry,
  type ErrorCode,
  type ErrorResponse,
  type SubmitRequest,
  type SubmitResponse,
} from '../../shared/scoreRules.ts';

export interface Env {
  TIMES: DurableObjectNamespace<DailyBoard>;
  ALLOWED_ORIGINS?: string;
  ALLOW_LOCALHOST?: string;
  ADMIN_TOKEN?: string;
}

/** Submissions allowed per address in a 10 minute window, and per day. */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_PER_WINDOW = 10;
const RATE_PER_DAY = 30;
/** Ceiling on new rows per day from everyone together. */
const INSERTS_PER_DAY = 5000;
/** Days kept in full; older days keep only their fastest rows. */
const KEEP_DAYS = 30;
const KEEP_OLD = 50;

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'origin', ...extra },
  });
}

function fail(error: ErrorCode, status: number, headers: Record<string, string>, more: Partial<ErrorResponse> = {}): Response {
  const body: ErrorResponse = { ok: false, error, ...more };
  return json(body, status, headers);
}

function isLocalhost(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** The request's Origin if it may use this API, else null. */
function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  if (env.ALLOW_LOCALHOST === 'true' && isLocalhost(origin)) return origin;
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function cors(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

/** Rate-limit key for a client address: IPv6 is reduced to its /64 network. */
export function addressKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...new Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < ea.length; i++) diff |= (ea[i] as number) ^ (eb[i % Math.max(1, eb.length)] ?? 0);
  return diff === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = allowedOrigin(req, env);
    const headers = cors(origin);
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, vary: 'origin' } });
      if (url.pathname === '/healthz') return json({ ok: true }, 200, headers);

      const board = env.TIMES.get(env.TIMES.idFromName('global'));

      const del = url.pathname.match(/^\/daily\/(\d{1,15})$/);
      if (del && req.method === 'DELETE') {
        // Not a browser route: no CORS, and it does not exist until a token is configured.
        if (!env.ADMIN_TOKEN) return fail('not-found', 404, {});
        const auth = req.headers.get('authorization') ?? '';
        if (!timingSafeEqual(auth, `Bearer ${env.ADMIN_TOKEN}`)) return fail('origin', 403, {});
        const removed = await board.remove(Number(del[1]));
        return removed ? json({ ok: true }) : fail('not-found', 404, {});
      }

      if (url.pathname !== '/daily') return fail('not-found', 404, headers);

      if (req.method === 'GET') {
        // Reads are public data. Browsers from other sites are refused; tools without an
        // Origin header (curl, uptime checks) may read.
        if (req.headers.has('origin') && !origin) return fail('origin', 403, {});
        const now = Date.now();
        const day = url.searchParams.get('day') ?? dayKey(now);
        if (!validDay(day)) return fail('invalid', 400, headers, { field: 'day' });
        if (!dayReadable(day, now)) return fail('day', 404, headers);
        return json(await board.board(day, clampLimit(url.searchParams.get('limit')), now), 200, headers);
      }

      if (req.method === 'POST') {
        if (!origin) return fail('origin', 403, {});
        const declared = Number(req.headers.get('content-length') ?? '0');
        if (declared > BODY_MAX_BYTES) return fail('too-large', 413, headers);
        const text = await req.text();
        if (new TextEncoder().encode(text).length > BODY_MAX_BYTES) return fail('too-large', 413, headers);
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return fail('bad-json', 400, headers);
        }
        const checked = validateSubmission(body);
        if (!checked.ok) return fail('invalid', 400, headers, { field: checked.field });
        const rule = checkDaily(checked.value, Date.now());
        if (rule) {
          console.log(JSON.stringify({ event: 'rejected', rule, day: checked.value.day, ms: checked.value.ms }));
          return fail(rule, 422, headers);
        }
        const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
        const result = await board.submit(checked.value, addressKey(ip), clampLimit(url.searchParams.get('limit')));
        if (result.ok) return json(result, 200, headers);
        if (result.error === 'rate') {
          return fail('rate', 429, { ...headers, 'retry-after': String(result.retryAfter ?? 600) }, { retryAfter: result.retryAfter });
        }
        return fail(result.error, 503, headers);
      }

      return fail('not-found', 405, { ...headers, allow: 'GET, POST, OPTIONS' });
    } catch (err) {
      console.error(JSON.stringify({ event: 'error', message: err instanceof Error ? err.message : String(err) }));
      return fail('server', 500, headers);
    }
  },
} satisfies ExportedHandler<Env>;

type Row = Record<string, SqlStorageValue>;

function toEntry(r: Row): Entry {
  return { id: Number(r.id), name: String(r.name), ms: Number(r.ms), at: Number(r.at) };
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class DailyBoard extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS times (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gid TEXT NOT NULL UNIQUE,
        day INTEGER NOT NULL,
        name TEXT NOT NULL,
        ms INTEGER NOT NULL,
        at INTEGER NOT NULL,
        n INTEGER NOT NULL,
        v INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS times_day ON times(day, ms, id);
      CREATE TABLE IF NOT EXISTS rate (
        ip TEXT NOT NULL,
        win INTEGER NOT NULL,
        n INTEGER NOT NULL,
        PRIMARY KEY (ip, win)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
    `);
  }

  private count(query: string, ...args: SqlStorageValue[]): number {
    return Number(this.sql.exec(query, ...args).one().n);
  }

  async board(day: string, limit: number, now = Date.now()): Promise<DayBoard> {
    const d = epochDay(day);
    return {
      now,
      day,
      total: this.count('SELECT COUNT(*) AS n FROM times WHERE day = ?', d),
      top: this.sql.exec('SELECT id, name, ms, at FROM times WHERE day = ? ORDER BY ms, id LIMIT ?', d, limit).toArray().map(toEntry),
    };
  }

  /** 1-based position on its day; equal times rank in order of submission. */
  private rank(day: number, ms: number, id: number): number {
    return 1 + this.count('SELECT COUNT(*) AS n FROM times WHERE day = ?1 AND (ms < ?2 OR (ms = ?2 AND id < ?3))', day, ms, id);
  }

  /** A daily random salt, so stored address hashes cannot be linked across days or reversed by lookup. */
  private salt(day: number): string {
    const key = `salt:${day}`;
    const found = this.sql.exec('SELECT v FROM meta WHERE k = ?', key).toArray()[0];
    if (found) return String(found.v);
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const value = hex(bytes.buffer);
    this.sql.exec("DELETE FROM meta WHERE k LIKE 'salt:%'");
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?)', key, value);
    return value;
  }

  private async respond(row: Row, duplicate: boolean, limit: number, now: number): Promise<SubmitResponse> {
    const entry = toEntry(row);
    const day = Number(row.day);
    return {
      ok: true,
      duplicate,
      entry,
      rank: this.rank(day, entry.ms, entry.id),
      board: await this.board(dayKey(day * DAY_MS), limit, now),
    };
  }

  async submit(req: SubmitRequest, address: string, limit: number): Promise<SubmitResponse | { ok: false; error: 'rate' | 'busy'; retryAfter?: number }> {
    const now = Date.now();

    // The same solve again (double click, retry after a lost response): answer with the stored row.
    const existing = this.sql.exec('SELECT * FROM times WHERE gid = ?', req.gid).toArray()[0];
    if (existing) return this.respond(existing, true, limit, now);

    const today = Math.floor(now / DAY_MS);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${this.salt(today)}|${address}`));
    const ip = hex(digest).slice(0, 16);
    const win = Math.floor(now / RATE_WINDOW_MS);
    const firstWinOfDay = Math.floor((today * DAY_MS) / RATE_WINDOW_MS);
    const inWindow = this.count('SELECT COALESCE(SUM(n), 0) AS n FROM rate WHERE ip = ? AND win = ?', ip, win);
    if (inWindow >= RATE_PER_WINDOW) return { ok: false, error: 'rate', retryAfter: Math.ceil(((win + 1) * RATE_WINDOW_MS - now) / 1000) };
    const inDay = this.count('SELECT COALESCE(SUM(n), 0) AS n FROM rate WHERE ip = ? AND win >= ?', ip, firstWinOfDay);
    if (inDay >= RATE_PER_DAY) return { ok: false, error: 'rate', retryAfter: Math.ceil(((today + 1) * DAY_MS - now) / 1000) };
    if (this.count('SELECT COUNT(*) AS n FROM times WHERE at >= ?', today * DAY_MS) >= INSERTS_PER_DAY) return { ok: false, error: 'busy' };

    this.sql.exec('INSERT INTO rate (ip, win, n) VALUES (?, ?, 1) ON CONFLICT (ip, win) DO UPDATE SET n = n + 1', ip, win);
    const row = this.sql
      .exec('INSERT INTO times (gid, day, name, ms, at, n, v) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *', req.gid, epochDay(req.day), req.name, req.ms, now, req.cols.length, req.v)
      .one();

    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + DAY_MS);
    return this.respond(row, false, limit, now);
  }

  async remove(id: number): Promise<boolean> {
    const before = this.count('SELECT COUNT(*) AS n FROM times WHERE id = ?', id);
    if (before === 0) return false;
    this.sql.exec('DELETE FROM times WHERE id = ?', id);
    console.log(JSON.stringify({ event: 'removed', id }));
    return true;
  }

  /** Keep recent days in full and the fastest rows of older days; forget old address hashes. */
  private prune(now: number): void {
    const cut = Math.floor(now / DAY_MS) - KEEP_DAYS;
    this.sql.exec(
      `DELETE FROM times WHERE id IN (
         SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY day ORDER BY ms, id) AS rn FROM times WHERE day < ?1)
         WHERE rn > ?2
       )`,
      cut,
      KEEP_OLD,
    );
    this.sql.exec('DELETE FROM rate WHERE win < ?', Math.floor((now - DAY_MS) / RATE_WINDOW_MS));
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    this.prune(now);
    await this.ctx.storage.setAlarm(now + DAY_MS);
  }
}
