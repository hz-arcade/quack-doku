import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { makeGeo } from '../src/engine/grid.ts';
import { buildHint } from '../src/engine/hints.ts';
import { parseRegions, parseSolution, type PackPuzzle } from '../src/engine/puzzle.ts';
import { detectLang, LANGS, list, matchLang, plural, setLang, t, TABLES } from '../src/i18n';
import { en } from '../src/i18n/en';
import { createClient } from '../src/net/leaderboard.ts';
import { describeHint } from '../src/ui/hintText.ts';
import { assignColours, colourDistance, PALETTE_DARK, PALETTE_LIGHT, regionNeighbours } from '../src/ui/palette.ts';

const keys = Object.keys(en).sort();
const placeholders = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
const root = new URL('../puzzles/', import.meta.url);
const puzzles: PackPuzzle[] = [
  ...(JSON.parse(readFileSync(new URL('levels.json', root), 'utf8')) as { levels: PackPuzzle[] }).levels,
  ...readdirSync(new URL('daily/', root))
    .filter((f) => f.endsWith('.json'))
    .slice(0, 3)
    .flatMap((f) => Object.values((JSON.parse(readFileSync(new URL(`daily/${f}`, root), 'utf8')) as { days: Record<string, PackPuzzle> }).days)),
];

afterAll(() => setLang('en', false));

describe('i18n', () => {
  it('every language has exactly the English keys with the same placeholders', () => {
    for (const lang of LANGS) {
      const table = TABLES[lang] as Record<string, string>;
      expect(Object.keys(table).sort(), lang).toEqual(keys);
      for (const k of keys) {
        expect(placeholders(table[k] ?? ''), `${lang}:${k}`).toBe(placeholders((en as Record<string, string>)[k] ?? ''));
        expect((table[k] ?? '').length, `${lang}:${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('every data-i18n key used in index.html exists', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const used = [...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThanOrEqual(3);
    for (const k of used) expect(keys, k).toContain(k);
  });

  it('every key the code builds at runtime exists', () => {
    for (let i = 0; i < 10; i++) expect(keys).toContain(`color.${i}`);
    for (let i = 0; i < 4; i++) expect(keys).toContain(`win.title.${i}`);
    for (let i = 1; i <= 3; i++) expect(keys).toContain(`coach.${i}`);
    for (const base of ['game.left', 'hint.mistakes']) for (const f of ['one', 'other']) expect(keys).toContain(`${base}.${f}`);
    for (const k of ['row', 'col', 'region']) {
      expect(keys).toContain(`hint.single.${k}`);
      expect(keys).toContain(`hint.block.${k}`);
      expect(keys).toContain(`hint.unit.${k}`);
      expect(keys).toContain(`hint.Unit.${k}`);
    }
    for (const k of ['regionRow', 'regionCol', 'rowRegion', 'colRegion']) expect(keys).toContain(`hint.confine.${k}`);
    for (const k of ['regionsRows', 'regionsCols', 'rowsRegions', 'colsRegions', 'rowsCols', 'colsRows']) expect(keys).toContain(`hint.pigeon.${k}`);
  });

  it('zh-TW uses unambiguous row and column words', () => {
    const tw = Object.values(TABLES['zh-TW']).join('');
    expect(tw).not.toMatch(/第 \{(row|rows)\} 行|第 \{(col|cols)\} 列/);
  });

  it('matches browser tags, pluralises and lists', () => {
    expect(matchLang('es-MX')).toBe('es');
    expect(matchLang('zh-Hant-HK')).toBe('zh-TW');
    expect(matchLang('zh')).toBe('zh-CN');
    expect(matchLang('fr')).toBeNull();
    expect(detectLang('?lang=es', ['zh-CN'])).toBe('es');
    expect(detectLang('', ['de'])).toBe('en');
    setLang('en', false);
    expect(plural('game.left', 1)).toBe('1 duck to go');
    expect(plural('game.left', 3)).toBe('3 ducks to go');
    expect(list(['2', '4'])).toBe('2 and 4');
    setLang('es', false);
    expect(list(['rosa', 'menta'])).toBe('rosa y menta');
  });
});

describe('hint text', () => {
  it('reads cleanly in every language for every step of many solves', () => {
    const seen = new Set<string>();
    for (const lang of LANGS) {
      setLang(lang, false);
      for (const p of puzzles.filter((_, i) => i % 9 === 0)) {
        const geo = makeGeo(p.n, parseRegions(p.n, p.r));
        const sol = parseSolution(p.n, p.s);
        const colours = assignColours(geo);
        const marks = new Uint8Array(p.n * p.n);
        for (let i = 0; i < 200; i++) {
          const h = buildHint({ geo, solution: sol, marks, autoX: false });
          const v = describeHint(h, geo, colours);
          expect(v.text.length).toBeGreaterThan(10);
          expect(v.text, `${lang}: ${v.text}`).not.toMatch(/[{}]|undefined|NaN/);
          if (h.kind !== 'step') break;
          seen.add(h.step.d.tech);
          const d = h.step.d;
          if (d.tech === 'single') marks[d.place] = 2;
          else for (const c of d.elim) if (marks[c] === 0) marks[c] = 1;
        }
      }
    }
    expect([...seen].sort()).toEqual(['block', 'clear', 'confine', 'pigeon', 'single', 'whatif']);
  });
});

describe('palette', () => {
  it('has ten distinct colours in both themes', () => {
    expect(new Set(PALETTE_LIGHT).size).toBe(10);
    expect(new Set(PALETTE_DARK).size).toBe(10);
  });

  it('gives touching regions clearly different colours on every puzzle', () => {
    let worst = Infinity;
    for (const p of puzzles) {
      const geo = makeGeo(p.n, parseRegions(p.n, p.r));
      const colours = assignColours(geo);
      expect(new Set(colours).size).toBe(p.n);
      for (const [a, b] of regionNeighbours(geo)) worst = Math.min(worst, colourDistance(PALETTE_LIGHT[colours[a]!]!, PALETTE_LIGHT[colours[b]!]!));
    }
    // The closest pair in the palette is about 0.062 apart; neighbours should never get it.
    expect(worst).toBeGreaterThan(0.065);
  });
});

describe('leaderboard client', () => {
  const board = { now: 1, day: '2026-10-07', total: 1, top: [{ id: 1, name: 'Sam', ms: 61000, at: 1 }] };
  const fakeFetch = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

  it('is disabled without a URL', async () => {
    const c = createClient({ baseUrl: '' });
    expect(c.enabled).toBe(false);
    expect(await c.fetchDay('2026-10-07')).toEqual({ ok: false, error: 'disabled', retryable: false });
  });

  it('reads a day board and checks its shape', async () => {
    expect(await createClient({ baseUrl: 'https://x.test', fetch: fakeFetch(200, board) }).fetchDay('2026-10-07')).toEqual({ ok: true, data: board });
    expect((await createClient({ baseUrl: 'https://x.test', fetch: fakeFetch(200, { nope: 1 }) }).fetchDay('2026-10-07')).ok).toBe(false);
  });

  it('maps failures to retryable or not', async () => {
    const rate = await createClient({ baseUrl: 'https://x.test', fetch: fakeFetch(429, { ok: false, error: 'rate', retryAfter: 30 }) }).submit({} as never);
    expect(rate).toEqual({ ok: false, error: 'rate', retryable: false, retryAfter: 30 });
    expect(await createClient({ baseUrl: 'https://x.test', fetch: fakeFetch(422, { ok: false, error: 'wrong' }) }).submit({} as never)).toEqual({ ok: false, error: 'rejected', retryable: false });
    expect(await createClient({ baseUrl: 'https://x.test', fetch: fakeFetch(503, {}) }).submit({} as never)).toEqual({ ok: false, error: 'server', retryable: true });
    const offline = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    expect(await createClient({ baseUrl: 'https://x.test', fetch: offline }).fetchDay('d')).toEqual({ ok: false, error: 'offline', retryable: true });
  });
});

describe('translations render', () => {
  it('fills parameters', () => {
    setLang('zh-CN', false);
    expect(t('game.level', { k: 7 })).toBe('第 7 关');
    setLang('en', false);
    expect(t('daily.number', { num: 3, size: 8 })).toBe('#3 · 8×8');
  });
});
