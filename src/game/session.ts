import { Board, clashes, isSolved, seenByDucks } from '../engine/board.ts';
import { CAND, DUCK, makeGeo, X, type Geo } from '../engine/grid.ts';
import { buildHint, type Hint } from '../engine/hints.ts';
import { parseRegions, parseSolution, type PackPuzzle } from '../engine/puzzle.ts';
import type { Progress } from './progress.ts';
import { Timer } from './timer.ts';

export type SessionKind = { type: 'level'; k: number } | { type: 'daily'; day: string; num: number };

export type SoundCue = 'duck' | 'x' | 'erase' | 'clash' | 'undo' | 'none';

export interface SessionHooks {
  /** Marks changed (null: redraw everything). */
  changed(cells: readonly number[] | null): void;
  solved(): void;
  sound(cue: SoundCue): void;
}

export function sessionKey(kind: SessionKind): string {
  return kind.type === 'level' ? `L${kind.k}` : `D${kind.day}`;
}

/**
 * One puzzle being played: the marks, the timer, hint count and win detection. Knows
 * nothing about the DOM. Every change is saved, so closing the tab loses nothing.
 */
export class Session {
  readonly kind: SessionKind;
  readonly pack: PackPuzzle;
  readonly pid: string;
  readonly geo: Geo;
  readonly solution: number[];
  readonly board: Board;
  readonly timer: Timer;
  hints: number;
  solved = false;
  /** The daily's Start button was pressed (levels start right away). */
  started: boolean;
  lastDuck = -1;

  private readonly progress: Progress;
  private readonly hooks: SessionHooks;
  private lastTap: { cell: number; depth: number; changed: boolean } | null = null;
  private dragMode: 'add' | 'erase' | null = null;
  private dragTouched: number[] = [];
  private revealNext = false;

  constructor(kind: SessionKind, pack: PackPuzzle, pid: string, progress: Progress, hooks: SessionHooks, timer = new Timer()) {
    this.kind = kind;
    this.pack = pack;
    this.pid = pid;
    this.progress = progress;
    this.hooks = hooks;
    this.timer = timer;
    this.geo = makeGeo(pack.n, parseRegions(pack.n, pack.r));
    this.solution = parseSolution(pack.n, pack.s);
    const saved = progress.getPlay(sessionKey(kind), pid);
    this.board = (saved && Board.parse(pack.n, saved.marks)) || new Board(pack.n);
    this.hints = saved?.hints ?? 0;
    this.timer.set(saved?.ms ?? 0);
    this.started = kind.type === 'level' || (saved?.started ?? false);
  }

  get n(): number {
    return this.geo.n;
  }

  get autoX(): boolean {
    return this.progress.settings.autoX;
  }

  /** Cells crossed automatically (all zero when auto-X is off). */
  derived(): Uint8Array {
    return this.autoX ? seenByDucks(this.geo, this.board.marks) : new Uint8Array(this.geo.size);
  }

  ducksLeft(): number {
    return this.n - this.board.ducks().length;
  }

  // ---- Input ----

  tap(cell: number): void {
    if (!this.canPlay()) return;
    const m = this.board.marks[cell];
    let cue: SoundCue = 'none';
    let changed = false;
    if (m === DUCK || m === X) {
      changed = this.board.set(cell, CAND);
      cue = 'erase';
    } else if (!this.derived()[cell]) {
      changed = this.board.set(cell, X);
      cue = 'x';
    }
    this.lastTap = { cell, depth: this.board.undoDepth, changed };
    if (changed) this.after([cell], cue);
  }

  /** Second tap of a double-tap: replace what the first tap did with a duck toggle. */
  double(cell: number): void {
    if (!this.canPlay()) return;
    const t = this.lastTap;
    this.lastTap = null;
    if (t && t.cell === cell && t.changed && this.board.undoDepth === t.depth) this.board.undo();
    this.toggleDuck(cell);
  }

  toggleDuck(cell: number): void {
    if (!this.canPlay()) return;
    const placing = this.board.marks[cell] !== DUCK;
    this.board.set(cell, placing ? DUCK : CAND);
    if (placing) this.lastDuck = cell;
    // A duck changes what is crossed automatically all over the board.
    this.after(this.autoX ? null : [cell], placing ? (this.isClash(cell) ? 'clash' : 'duck') : 'erase');
  }

  dragStart(cell: number): void {
    if (!this.canPlay()) return;
    this.lastTap = null;
    this.dragMode = this.board.marks[cell] === X ? 'erase' : 'add';
    this.dragTouched = [];
    this.board.begin();
    this.dragCells([cell]);
  }

  dragTo(cells: readonly number[]): void {
    if (this.dragMode) this.dragCells(cells);
  }

  dragEnd(): void {
    if (!this.dragMode) return;
    this.dragMode = null;
    this.board.end();
    if (this.dragTouched.length) this.save();
  }

  private dragCells(cells: readonly number[]): void {
    const derived = this.derived();
    const touched: number[] = [];
    for (const c of cells) {
      const m = this.board.marks[c];
      if (this.dragMode === 'add' && m === CAND && !derived[c] && this.board.set(c, X)) touched.push(c);
      if (this.dragMode === 'erase' && m === X && this.board.set(c, CAND)) touched.push(c);
    }
    if (touched.length) {
      this.dragTouched.push(...touched);
      this.hooks.changed(touched);
      this.hooks.sound(this.dragMode === 'add' ? 'x' : 'erase');
    }
  }

  undo(): void {
    if (!this.canPlay()) return;
    this.lastTap = null;
    const cells = this.board.undo();
    if (cells) this.after(this.autoX ? null : cells, 'undo');
  }

  reset(): void {
    if (!this.canPlay()) return;
    this.lastTap = null;
    const cells = this.board.reset();
    if (cells.length) this.after(null, 'erase');
  }

  // ---- Hints ----

  /** The next hint. Showing one counts toward the hint total. */
  hint(): Hint {
    const h = buildHint({
      geo: this.geo,
      solution: this.solution,
      marks: this.board.marks,
      autoX: this.autoX,
      revealMistakes: this.revealNext,
      lastDuck: this.lastDuck,
    });
    if (h.kind === 'done') return h;
    // Pointing out the mistakes after counting them is the same hint, not another one.
    const reveal = this.revealNext && h.kind === 'mistakes';
    this.revealNext = h.kind === 'mistakes' && h.cells.length === 0;
    if (!reveal) this.hints++;
    this.save();
    return h;
  }

  /** "Show me": carry out a hint on the board as one undo step. */
  applyHint(h: Hint): void {
    if (!this.canPlay() || h.kind === 'done') return;
    this.lastTap = null;
    this.board.begin();
    let cue: SoundCue = 'x';
    if (h.kind === 'mistakes') {
      for (const c of h.cells) this.board.set(c, CAND);
      cue = 'erase';
    } else {
      const d = h.step.d;
      if (d.tech === 'single') {
        this.board.set(d.place, DUCK);
        this.lastDuck = d.place;
        cue = 'duck';
      } else {
        for (const c of d.elim) if (this.board.marks[c] === CAND) this.board.set(c, X);
      }
    }
    this.board.end();
    this.after(null, cue);
  }

  // ---- State ----

  isClash(cell: number): boolean {
    return clashes(this.geo, this.board.marks).some(([a, b]) => a === cell || b === cell);
  }

  canPlay(): boolean {
    return !this.solved && this.started;
  }

  start(): void {
    this.started = true;
    this.timer.start();
    this.save();
  }

  save(): void {
    if (this.solved) return;
    this.progress.savePlay(sessionKey(this.kind), {
      pid: this.pid,
      marks: this.board.serialize(),
      ms: Math.round(this.timer.ms),
      hints: this.hints,
      started: this.started,
    });
  }

  private after(cells: readonly number[] | null, cue: SoundCue): void {
    this.hooks.changed(cells);
    this.hooks.sound(cue);
    if (isSolved(this.geo, this.board.marks)) {
      this.solved = true;
      this.timer.stop();
      this.progress.clearPlay(sessionKey(this.kind));
      this.hooks.solved();
    } else {
      this.save();
    }
  }
}
