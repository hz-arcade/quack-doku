import { describe, expect, it } from 'vitest';
import { DAILY_ANSWERS, DAILY_FIRST } from '../shared/dailyAnswers.ts';
import { addDays, dailyNumber, DAY_MS, dayStart, LAUNCH_DAY, weekday } from '../shared/day.ts';
import { checkDaily, clampLimit, dayReadable, dayWindowOk, msFloor, sanitizeName, SKEW_MS, validateSubmission } from '../shared/scoreRules.ts';

const GID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const firstAnswer = DAILY_ANSWERS.split(',')[0]!;
const good = { v: 1, gid: GID, day: DAILY_FIRST, name: 'Sam', ms: 95_000, cols: firstAnswer };

describe('days', () => {
  it('knows weekdays and puzzle numbers', () => {
    expect(weekday('2026-10-05')).toBe(0); // a Monday
    expect(weekday('2026-10-11')).toBe(6);
    expect(dailyNumber(LAUNCH_DAY)).toBe(1);
    expect(dailyNumber(addDays(LAUNCH_DAY, 30))).toBe(31);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(Number.isNaN(dayStart('2026-02-30'))).toBe(true);
  });
});

describe('sanitizeName', () => {
  it('keeps ordinary names in any script, and emoji', () => {
    expect(sanitizeName('Sam Dam')).toBe('Sam Dam');
    expect(sanitizeName('小明')).toBe('小明');
    expect(sanitizeName('張偉 🦆')).toBe('張偉 🦆');
    expect(sanitizeName('Zoë')).toBe('Zoë');
  });
  it('trims and collapses whitespace, including ideographic space and newlines', () => {
    expect(sanitizeName('  a \t\n  b  ')).toBe('a b');
    expect(sanitizeName('小\u3000\u3000明')).toBe('小 明');
    expect(sanitizeName('a\u2028b')).toBe('a b');
  });
  it('removes control, zero-width and bidi override characters', () => {
    expect(sanitizeName('a\u0000b\u0007c')).toBe('abc');
    expect(sanitizeName('ab\u200b\u200d\ufeffcd')).toBe('abcd');
    expect(sanitizeName('\u202eevil\u202c')).toBe('evil');
    expect(sanitizeName('x\u2066y\u2069')).toBe('xy');
  });
  it('removes private-use characters and unpaired surrogates', () => {
    expect(sanitizeName('a\ue000b')).toBe('ab');
    expect(sanitizeName('a\ud83db')).toBe('ab');
  });
  it('limits stacked combining marks and drops leading ones', () => {
    expect(sanitizeName('e' + '\u0301'.repeat(30))).toBe('é\u0301\u0301');
    expect(Array.from(sanitizeName('\u0301\u0301abc'))).toEqual(['a', 'b', 'c']);
  });
  it('truncates to 16 code points without splitting an emoji', () => {
    expect(Array.from(sanitizeName('a'.repeat(40)))).toHaveLength(16);
    expect(sanitizeName('🦆'.repeat(30))).toBe('🦆'.repeat(16));
  });
  it('returns an empty string when nothing usable is left', () => {
    expect(sanitizeName('')).toBe('');
    expect(sanitizeName('\u200b\u200b')).toBe('');
    expect(sanitizeName(null)).toBe('');
    expect(sanitizeName({ toString: () => 'x' })).toBe('');
  });
});

describe('validateSubmission', () => {
  it('accepts a well-formed submission and returns the sanitised name', () => {
    expect(validateSubmission({ ...good, name: '  Sam\u200b ', gid: GID.toUpperCase(), extra: 1 })).toEqual({ ok: true, value: good });
  });
  it.each([
    ['body', null],
    ['body', [good]],
    ['v', { ...good, v: 2 }],
    ['gid', { ...good, gid: 'nope' }],
    ['day', { ...good, day: '2026-1-7' }],
    ['day', { ...good, day: '2026-02-30' }],
    ['name', { ...good, name: '  ' }],
    ['ms', { ...good, ms: 0 }],
    ['ms', { ...good, ms: 1.5 }],
    ['ms', { ...good, ms: 6 * 3_600_000 + 1 }],
    ['cols', { ...good, cols: 'ABC' }],
    ['cols', { ...good, cols: 7 }],
  ])('rejects a bad %s', (field, body) => {
    expect(validateSubmission(body)).toEqual({ ok: false, field });
  });
});

describe('checkDaily', () => {
  const start = dayStart(DAILY_FIRST);
  it('accepts the right answer on its day', () => {
    expect(checkDaily(good, start + 3_600_000)).toBeNull();
  });
  it('allows two hours of clock skew either side of midnight, no more', () => {
    expect(dayWindowOk(DAILY_FIRST, start - SKEW_MS)).toBe(true);
    expect(dayWindowOk(DAILY_FIRST, start - SKEW_MS - 1)).toBe(false);
    expect(dayWindowOk(DAILY_FIRST, start + DAY_MS + SKEW_MS - 1)).toBe(true);
    expect(checkDaily(good, start + DAY_MS + SKEW_MS)).toBe('day');
  });
  it('rejects a wrong answer and impossible speed', () => {
    const wrong = firstAnswer.split('').reverse().join('');
    expect(checkDaily({ ...good, cols: wrong }, start + 1000)).toBe('wrong');
    expect(checkDaily({ ...good, ms: msFloor(firstAnswer.length) - 1 }, start + 1000)).toBe('too-fast');
    expect(checkDaily({ ...good, ms: msFloor(firstAnswer.length) }, start + 1000)).toBeNull();
  });
  it('rejects days before the first puzzle', () => {
    const before = addDays(DAILY_FIRST, -1);
    expect(checkDaily({ ...good, day: before }, dayStart(before) + 1000)).toBe('wrong');
  });
});

describe('reading boards', () => {
  it('serves the last week only', () => {
    const now = dayStart('2026-10-20') + 5 * 3_600_000;
    expect(dayReadable('2026-10-20', now)).toBe(true);
    expect(dayReadable('2026-10-14', now)).toBe(true);
    expect(dayReadable('2026-10-13', now)).toBe(false);
    expect(dayReadable('2026-10-21', now)).toBe(false);
    expect(dayReadable('2026-10-21', dayStart('2026-10-21') - 3_600_000)).toBe(true);
  });
  it('clamps the row limit', () => {
    expect(clampLimit(null)).toBe(20);
    expect(clampLimit('5')).toBe(5);
    expect(clampLimit('999')).toBe(50);
    expect(clampLimit('-3')).toBe(1);
    expect(clampLimit('x')).toBe(20);
  });
});
