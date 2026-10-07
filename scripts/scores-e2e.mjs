/**
 * End-to-end check of the Daily Duck leaderboard Worker, run against a local `wrangler dev`
 * with a throwaway database. Nothing is deployed and no Cloudflare account is needed.
 *   npm run scores:e2e
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { answerFor } from '../shared/daily.ts';
import { DAILY_ANSWERS, DAILY_FIRST } from '../shared/dailyAnswers.ts';
import { addDays, dayKey } from '../shared/day.ts';

const LOCAL = 'http://localhost:5187';
const FOREIGN = 'https://evil.example';
let failures = 0;
let checks = 0;

function check(name, cond, detail = '') {
  checks++;
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function startWorker(port, vars) {
  const dir = mkdtempSync(path.join(tmpdir(), 'quack-doku-scores-'));
  const args = ['wrangler', 'dev', '--local', '--port', String(port), '--config', 'worker/wrangler.toml', '--persist-to', dir];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const proc = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return { base, stop };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`worker did not start on port ${port}\n${log.slice(-2000)}`);
}

const today = dayKey(Date.now());
const yesterday = addDays(today, -1);
const answer = answerFor(today, DAILY_FIRST, DAILY_ANSWERS);
if (!answer) throw new Error(`no daily answer for ${today}`);
const wrong = answer.split('').reverse().join('');
const sub = (over = {}) => ({ v: 1, gid: randomUUID(), day: today, name: 'Sam', ms: 95_000, cols: answer, ...over });

async function post(base, body, origin = LOCAL, raw = false) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  const r = await fetch(`${base}/daily`, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) };
}

async function main() {
  console.log(`worker with localhost allowed and an admin token (today ${today})`);
  const w = await startWorker(8796, { ALLOW_LOCALHOST: 'true', ADMIN_TOKEN: 'test-token' });
  try {
    const { base } = w;

    let r = await fetch(`${base}/healthz`);
    check('healthz', r.status === 200 && (await r.json()).ok === true);

    r = await fetch(`${base}/daily`);
    let b = await r.json();
    check('today’s empty board is readable without Origin', r.status === 200 && b.day === today && b.total === 0 && b.top.length === 0, JSON.stringify(b));
    check('responses are not cacheable', r.headers.get('cache-control') === 'no-store');
    r = await fetch(`${base}/daily?day=${addDays(today, -10)}`);
    check('old days are not served', r.status === 404);
    r = await fetch(`${base}/daily?day=2026-13-40`);
    check('malformed day is refused', r.status === 400);

    r = await fetch(`${base}/daily`, { headers: { origin: FOREIGN } });
    check('GET from a foreign origin is refused without CORS headers', r.status === 403 && !r.headers.get('access-control-allow-origin'));
    r = await fetch(`${base}/daily`, { method: 'OPTIONS', headers: { origin: LOCAL, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    check('preflight from an allowed origin', r.status === 204 && r.headers.get('access-control-allow-origin') === LOCAL);

    let p = await post(base, sub(), null);
    check('POST without Origin is refused', p.status === 403 && p.json?.error === 'origin');
    p = await post(base, sub(), FOREIGN);
    check('POST from a foreign origin is refused', p.status === 403);

    const first = sub({ name: '  Sam \u200b Dam ' });
    p = await post(base, first);
    check('a correct solve is saved', p.status === 200 && p.json?.ok === true && p.json.duplicate === false, JSON.stringify(p.json));
    check('name comes back sanitised', p.json?.entry?.name === 'Sam Dam');
    check('first entry ranks 1', p.json?.rank === 1);
    check('response carries the fresh board', p.json?.board?.total === 1 && p.json.board.top[0]?.id === p.json.entry.id);
    check('only public fields are exposed', JSON.stringify(Object.keys(p.json.entry).sort()) === '["at","id","ms","name"]');
    const firstId = p.json.entry.id;

    p = await post(base, { ...first, ms: 50_000 });
    check('same solve again returns the stored row', p.status === 200 && p.json?.duplicate === true && p.json.entry.id === firstId && p.json.entry.ms === 95_000);

    p = await post(base, sub({ cols: wrong }));
    check('a wrong answer is rejected', p.status === 422 && p.json?.error === 'wrong', JSON.stringify(p.json));
    p = await post(base, sub({ ms: 500 }));
    check('an impossibly fast time is rejected', p.status === 422 && p.json?.error === 'too-fast');
    p = await post(base, sub({ day: addDays(today, -3), cols: answerFor(addDays(today, -3), DAILY_FIRST, DAILY_ANSWERS) ?? answer }));
    check('a stale day is rejected', p.status === 422, JSON.stringify(p.json));
    p = await post(base, sub({ ms: 1.5 }));
    check('malformed field is rejected and named', p.status === 400 && p.json?.field === 'ms');
    p = await post(base, sub({ name: ' \u200b ' }));
    check('empty name is rejected', p.status === 400 && p.json?.field === 'name');
    p = await post(base, '{nope', LOCAL, true);
    check('bad JSON is rejected', p.status === 400 && p.json?.error === 'bad-json');
    p = await post(base, JSON.stringify({ ...sub(), pad: 'x'.repeat(2000) }), LOCAL, true);
    check('oversized body is rejected', p.status === 413);

    p = await post(base, sub({ name: '小明', ms: 61_000 }));
    check('a faster time takes rank 1', p.status === 200 && p.json.rank === 1 && p.json.board.top[1].id === firstId, JSON.stringify(p.json?.rank));
    p = await post(base, sub({ name: 'Tie', ms: 95_000 }));
    check('an equal time ranks after the earlier one', p.status === 200 && p.json.rank === 3);
    const tieId = p.json.entry.id;

    b = await (await fetch(`${base}/daily?limit=2`, { headers: { origin: LOCAL } })).json();
    check('limit trims the list but not the total', b.top.length === 2 && b.total === 3);
    r = await fetch(`${base}/daily?day=${yesterday}`);
    b = await r.json();
    check('yesterday has its own board', r.status === 200 && b.day === yesterday && b.total === 0);

    r = await fetch(`${base}/daily/${tieId}`, { method: 'DELETE' });
    check('delete without a token is refused', r.status === 403);
    r = await fetch(`${base}/daily/${tieId}`, { method: 'DELETE', headers: { authorization: 'Bearer test-token' } });
    check('delete with the token removes the row', r.status === 200);
    b = await (await fetch(`${base}/daily`)).json();
    check('removed row is gone', b.total === 2 && !b.top.some((e) => e.id === tieId));

    // Rate limit: 10 stored submissions per window. Three are stored so far.
    let last;
    for (let i = 0; i < 7; i++) last = await post(base, sub({ name: `P${i}`, ms: 120_000 + i }));
    check('tenth submission in the window is still accepted', last.status === 200, String(last.status));
    p = await post(base, sub({ name: 'Flood' }));
    check('eleventh is rate limited with retry-after', p.status === 429 && p.json?.retryAfter > 0 && Number(p.headers.get('retry-after')) > 0, JSON.stringify(p.json));
    p = await post(base, first);
    check('a repeat of a stored solve still answers while rate limited', p.status === 200 && p.json.duplicate === true);

    r = await fetch(`${base}/nope`);
    check('unknown path', r.status === 404);
  } finally {
    w.stop();
  }

  console.log('worker with production settings (no localhost, no admin token)');
  const w2 = await startWorker(8797, {});
  try {
    const { base } = w2;
    let p = await post(base, sub(), LOCAL);
    check('localhost origin is refused in production settings', p.status === 403);
    p = await post(base, sub(), 'https://arcade.hz.ax');
    check('the live site origin is accepted', p.status === 200 && p.json?.ok === true, JSON.stringify(p.json));
    p = await post(base, sub(), 'https://arcade.hz.ax.evil.example');
    check('a look-alike origin is refused', p.status === 403);
    const r = await fetch(`${base}/daily/1`, { method: 'DELETE', headers: { authorization: 'Bearer undefined' } });
    check('delete route does not exist without a configured token', r.status === 404);
  } finally {
    w2.stop();
  }

  console.log(`${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
