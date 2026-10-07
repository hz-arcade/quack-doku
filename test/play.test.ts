import { describe, expect, it } from 'vitest';
import { Board, clashes, crowdedUnits, isSolved, seenByDucks } from '../src/engine/board.ts';
import { Gestures, lineCells } from '../src/engine/gestures.ts';
import { CAND, DUCK, makeGeo, X } from '../src/engine/grid.ts';
import { parseRegions, type PackPuzzle } from '../src/engine/puzzle.ts';
import { Progress } from '../src/game/progress.ts';
import { Session, type SessionHooks } from '../src/game/session.ts';
import { Timer } from '../src/game/timer.ts';
import { MemStore } from './helpers/memStore.ts';

describe('gestures', () => {
  it('tap, then a quick second tap on the same cell is a double-tap', () => {
    const g = new Gestures(5);
    expect(g.down(7, 0)).toEqual([]);
    expect(g.up(80)).toEqual([{ type: 'tap', cell: 7 }]);
    g.down(7, 250);
    expect(g.up(320)).toEqual([{ type: 'double', cell: 7 }]);
    // A third tap starts over.
    g.down(7, 400);
    expect(g.up(450)).toEqual([{ type: 'tap', cell: 7 }]);
  });

  it('slow taps and taps on different cells stay single taps', () => {
    const g = new Gestures(5);
    g.down(3, 0);
    g.up(50);
    g.down(3, 400);
    expect(g.up(450)).toEqual([{ type: 'tap', cell: 3 }]);
    g.down(4, 500);
    expect(g.up(540)).toEqual([{ type: 'tap', cell: 4 }]);
  });

  it('dragging reports each crossed cell once, filling gaps from fast swipes', () => {
    const g = new Gestures(5);
    g.down(0, 0);
    expect(g.move(0)).toEqual([]);
    expect(g.move(3)).toEqual([{ type: 'dragStart', cell: 0 }, { type: 'dragTo', cells: [1, 2, 3] }]);
    expect(g.move(2)).toEqual([]);
    expect(g.move(-1)).toEqual([]);
    expect(g.move(8)).toEqual([{ type: 'dragTo', cells: [8] }]);
    expect(g.up(300)).toEqual([{ type: 'dragEnd' }]);
    // A drag never counts toward a double-tap.
    g.down(8, 350);
    expect(g.up(380)).toEqual([{ type: 'tap', cell: 8 }]);
  });

  it('cancel ends a drag', () => {
    const g = new Gestures(4);
    g.down(0, 0);
    g.move(5);
    expect(g.cancel()).toEqual([{ type: 'dragEnd' }]);
    expect(g.up(10)).toEqual([]);
  });

  it('draws straight lines across the grid', () => {
    expect(lineCells(5, 0, 24)).toEqual([6, 12, 18, 24]);
    expect(lineCells(5, 4, 0)).toEqual([3, 2, 1, 0]);
    // Either diagonal step is fine; the path must stay connected and end on the target.
    expect(lineCells(5, 0, 11)).toHaveLength(2);
    expect(lineCells(5, 0, 11).at(-1)).toBe(11);
  });
});

describe('board', () => {
  it('groups changes into undo steps', () => {
    const b = new Board(4);
    b.set(0, X);
    b.begin();
    b.set(1, X);
    b.set(2, X);
    b.set(1, CAND);
    b.end();
    expect(b.serialize()).toBe('x.x.............');
    expect(b.undoDepth).toBe(2);
    expect(b.undo()).toEqual([1, 2]);
    expect(b.serialize()).toBe('x...............');
    b.reset();
    expect(b.serialize()).toBe('................');
    b.undo();
    expect(b.serialize()).toBe('x...............');
  });

  it('round-trips through its text form and rejects junk', () => {
    const b = Board.parse(4, '.xD.............')!;
    expect(b.marks[1]).toBe(X);
    expect(b.marks[2]).toBe(DUCK);
    expect(Board.parse(4, 'nope')).toBeNull();
    expect(Board.parse(4, '?'.repeat(16))).toBeNull();
  });

  it('finds clashes, crowded units, what ducks rule out, and a win', () => {
    const geo = makeGeo(5, parseRegions(5, 'aaaeeacceeacceeadcceabbbb'));
    const m = new Uint8Array(25);
    m[0] = DUCK;
    m[6] = DUCK;
    expect(clashes(geo, m)).toEqual([[0, 6]]);
    expect(crowdedUnits(geo, m)).toEqual([]);
    m[6] = CAND;
    m[5] = DUCK;
    expect(crowdedUnits(geo, m)).toEqual([5, 10]); // column 0 and region a
    m[5] = CAND;
    expect(seenByDucks(geo, m).reduce((a, b) => a + b, 0)).toBe(geo.sees[0]!.length);
    for (const c of [0, 7, 14, 16, 23]) m[c] = DUCK;
    expect(isSolved(geo, m)).toBe(true);
  });
});

const PACK: PackPuzzle = { n: 5, r: 'aaaeeacceeacceeadcceabbbb', s: '02413', id: 'test0001', d: 5, t: 1, w: 0 };

function makeSession(progress = new Progress(new MemStore()), kind: 'level' | 'daily' = 'level') {
  const log = { changed: 0, solved: 0, sounds: [] as string[] };
  const hooks: SessionHooks = {
    changed: () => log.changed++,
    solved: () => log.solved++,
    sound: (c) => log.sounds.push(c),
  };
  let now = 0;
  const timer = new Timer(() => now);
  const s = new Session(kind === 'level' ? { type: 'level', k: 1 } : { type: 'daily', day: '2026-10-07', num: 1 }, PACK, PACK.id, progress, hooks, timer);
  return { s, log, progress, tick: (ms: number) => (now += ms) };
}

describe('session', () => {
  it('tap marks X, tap again clears, double-tap places a duck in one undo step', () => {
    const { s } = makeSession();
    s.tap(3);
    expect(s.board.marks[3]).toBe(X);
    s.tap(3);
    expect(s.board.marks[3]).toBe(CAND);
    s.tap(8);
    s.double(8);
    expect(s.board.marks[8]).toBe(DUCK);
    s.undo();
    expect(s.board.marks[8]).toBe(CAND);
    // Double-tapping a duck takes it away.
    s.toggleDuck(8);
    s.tap(8);
    s.double(8);
    expect(s.board.marks[8]).toBe(CAND);
  });

  it('a drag that starts on an X erases, otherwise it crosses, and never touches ducks', () => {
    const { s } = makeSession();
    s.toggleDuck(2);
    s.dragStart(0);
    s.dragTo([1, 2, 3]);
    s.dragEnd();
    expect(s.board.serialize().slice(0, 5)).toBe('xxDx.');
    s.dragStart(1);
    s.dragTo([0]);
    s.dragEnd();
    expect(s.board.serialize().slice(0, 5)).toBe('..Dx.');
    s.undo();
    expect(s.board.serialize().slice(0, 5)).toBe('xxDx.');
  });

  it('auto-cross shows what ducks rule out and taps there do nothing', () => {
    const progress = new Progress(new MemStore());
    progress.setSetting('autoX', true);
    const { s } = makeSession(progress);
    s.toggleDuck(0);
    expect(s.derived()[1]).toBe(1);
    s.tap(1);
    expect(s.board.marks[1]).toBe(CAND);
  });

  it('detects the win, stops the clock and forgets the saved board', () => {
    const { s, log, progress, tick } = makeSession();
    s.timer.start();
    tick(5000);
    for (const c of [0, 7, 14, 16]) s.toggleDuck(c);
    expect(progress.hasPlay('L1')).toBe(true);
    s.toggleDuck(23);
    expect(log.solved).toBe(1);
    expect(s.solved).toBe(true);
    expect(s.timer.ms).toBe(5000);
    expect(progress.hasPlay('L1')).toBe(false);
    s.tap(1);
    expect(s.board.marks[1]).toBe(CAND);
  });

  it('restores a saved board, time and hint count', () => {
    const progress = new Progress(new MemStore());
    const a = makeSession(progress);
    a.s.timer.start();
    a.tick(1234);
    a.s.toggleDuck(0);
    a.s.hint();
    const b = makeSession(progress);
    expect(b.s.board.marks[0]).toBe(DUCK);
    expect(b.s.hints).toBe(1);
    expect(b.s.timer.ms).toBe(1234);
  });

  it('the daily waits for Start', () => {
    const { s } = makeSession(new Progress(new MemStore()), 'daily');
    expect(s.started).toBe(false);
    s.tap(0);
    expect(s.board.marks[0]).toBe(CAND);
    s.start();
    s.tap(0);
    expect(s.board.marks[0]).toBe(X);
  });

  it('counting mistakes and then showing them is one hint', () => {
    const { s } = makeSession();
    s.toggleDuck(1);
    expect(s.hint().kind).toBe('mistakes');
    const shown = s.hint();
    expect(shown.kind === 'mistakes' && shown.cells).toEqual([1]);
    expect(s.hints).toBe(1);
    s.applyHint(shown);
    expect(s.board.marks[1]).toBe(CAND);
  });
});

describe('progress', () => {
  it('opens solved levels plus the next three', () => {
    const p = new Progress(new MemStore());
    expect([...p.openLevels()]).toEqual([1, 2, 3]);
    p.recordLevel(1, 1000, 0);
    p.recordLevel(3, 1000, 2);
    expect([...p.openLevels()]).toEqual([1, 2, 3, 4, 5]);
    expect(p.nextLevel()).toBe(2);
    expect(p.nextAfter(3)).toBe(4);
    expect(p.stars(1)).toBe(3);
    expect(p.stars(3)).toBe(2);
    expect(p.stars(2)).toBe(0);
  });

  it('keeps the best time and fewest hints', () => {
    const p = new Progress(new MemStore());
    expect(p.recordLevel(5, 9000, 3)).toEqual({ first: true, newBest: false, prevMs: null });
    expect(p.recordLevel(5, 7000, 4)).toEqual({ first: false, newBest: true, prevMs: 9000 });
    expect(p.levels[5]).toMatchObject({ ms: 7000, hints: 3 });
  });

  it('counts streaks of on-the-day solves across months', () => {
    const p = new Progress(new MemStore());
    for (const d of ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) p.recordDaily(d, 60_000, 0, true);
    p.recordDaily('2026-10-27', 60_000, 0, true);
    p.recordDaily('2026-10-28', 60_000, 0, false);
    expect(p.streak('2026-11-01')).toBe(4);
    expect(p.streak('2026-11-02')).toBe(4); // today not solved yet
    expect(p.streak('2026-11-03')).toBe(0);
    expect(p.bestStreak()).toBe(4);
    // A replay never replaces the first result.
    p.recordDaily('2026-10-28', 1000, 0, true);
    expect(p.dailyResult('2026-10-28')?.onDay).toBe(false);
  });

  it('survives corrupt or foreign data', () => {
    const store = new MemStore();
    store.setItem('quack-doku.progress', '{not json');
    store.setItem('quack-doku.daily', JSON.stringify({ v: 1, results: { '2026-13-01': { ms: 1, hints: 0, onDay: true, at: 1 }, '2026-10-07': { ms: -5 } } }));
    store.setItem('quack-doku.play', JSON.stringify({ v: 2, boards: {} }));
    store.setItem('quack-doku.settings', JSON.stringify({ v: 1, autoX: 'yes', timer: false }));
    const p = new Progress(store);
    expect(p.levels).toEqual({});
    expect(p.daily).toEqual({});
    expect(p.settings).toMatchObject({ autoX: false, timer: false });
    store.setItem('quack-doku.progress', JSON.stringify({ v: 1, levels: { 2: { ms: 100, hints: 0, at: 1 }, 999: { ms: 1, hints: 0, at: 1 }, 3: { ms: 'x' } } }));
    expect(Object.keys(new Progress(store).levels)).toEqual(['2']);
  });

  it('ignores a saved board for a different puzzle', () => {
    const p = new Progress(new MemStore());
    p.savePlay('L1', { pid: 'aaaa', marks: '.'.repeat(25), ms: 0, hints: 0, started: true });
    expect(p.getPlay('L1', 'aaaa')).not.toBeNull();
    expect(p.getPlay('L1', 'bbbb')).toBeNull();
  });
});
