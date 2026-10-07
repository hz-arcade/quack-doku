import { Gestures, type GestureAction } from '../engine/gestures.ts';
import type { Session } from '../game/session.ts';
import type { BoardView } from './boardView.ts';

export interface InputHooks {
  /** Called before any board action (dismisses hints, unlocks audio). */
  beforeAction(): void;
  hint(): void;
}

/**
 * Pointer and keyboard input for the board. Pointer events only (no click/dblclick, which
 * phones delay and zoom on); the gesture state machine decides tap, double-tap or drag.
 */
export class BoardInput {
  private readonly view: BoardView;
  private readonly hooks: InputHooks;
  private session: Session | null = null;
  private gestures = new Gestures(1);
  private pointerId: number | null = null;
  private cursor = -1;

  constructor(view: BoardView, hooks: InputHooks) {
    this.view = view;
    this.hooks = hooks;
    const el = view.el;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('lostpointercapture', (e) => this.cancel(e));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const cell = this.view.cellAt(e.clientX, e.clientY);
      if (cell >= 0 && this.session) {
        this.hooks.beforeAction();
        this.session.toggleDuck(cell);
      }
    });
    el.addEventListener('keydown', (e) => this.key(e));
  }

  attach(session: Session | null): void {
    this.session = session;
    this.gestures = new Gestures(session?.n ?? 1);
    this.pointerId = null;
    this.cursor = -1;
  }

  forgetTap(): void {
    this.gestures.forgetTap();
  }

  private run(actions: GestureAction[]): void {
    const s = this.session;
    if (!s || actions.length === 0) return;
    this.hooks.beforeAction();
    for (const a of actions) {
      if (a.type === 'tap') s.tap(a.cell);
      else if (a.type === 'double') s.double(a.cell);
      else if (a.type === 'dragStart') s.dragStart(a.cell);
      else if (a.type === 'dragTo') s.dragTo(a.cells);
      else s.dragEnd();
    }
  }

  private down(e: PointerEvent): void {
    if (!e.isPrimary || e.button > 0 || !this.session?.canPlay()) return;
    const cell = this.view.cellAt(e.clientX, e.clientY);
    if (cell < 0) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.view.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests */
    }
    this.run(this.gestures.down(cell, e.timeStamp));
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.run(this.gestures.move(this.view.cellAt(e.clientX, e.clientY)));
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.run(this.gestures.up(e.timeStamp));
  }

  private cancel(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.run(this.gestures.cancel());
  }

  private key(e: KeyboardEvent): void {
    const s = this.session;
    if (!s || e.altKey || e.metaKey) return;
    const n = s.n;
    if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      this.hooks.beforeAction();
      s.undo();
      return;
    }
    if (e.ctrlKey) return;
    if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      this.hooks.hint();
      return;
    }
    if (!s.canPlay()) return;
    let cur = this.cursor < 0 ? 0 : this.cursor;
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const mv = moves[e.key];
    if (mv) {
      e.preventDefault();
      const r = Math.min(n - 1, Math.max(0, Math.floor(cur / n) + mv[0]));
      const c = Math.min(n - 1, Math.max(0, (cur % n) + mv[1]));
      const next = r * n + c;
      if (e.shiftKey && this.cursor >= 0) {
        this.hooks.beforeAction();
        s.dragStart(cur);
        s.dragTo([next]);
        s.dragEnd();
      }
      this.setCursor(next);
      return;
    }
    if (this.cursor < 0 && [' ', 'Enter', 'd', 'D', 'x', 'X', 'Backspace', 'Delete'].includes(e.key)) {
      this.setCursor(0);
      cur = 0;
    }
    if (e.key === ' ' || e.key === 'x' || e.key === 'X') {
      e.preventDefault();
      this.hooks.beforeAction();
      s.tap(cur);
    } else if (e.key === 'Enter' || e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      this.hooks.beforeAction();
      s.toggleDuck(cur);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (s.board.marks[cur] !== 0) {
        this.hooks.beforeAction();
        s.tap(cur);
      }
    }
  }

  private setCursor(i: number): void {
    this.cursor = i;
    this.view.setCursor(i);
  }
}
