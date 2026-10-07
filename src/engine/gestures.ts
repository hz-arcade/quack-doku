/**
 * Pointer gestures on the board, as a pure state machine so it can be tested with made-up
 * timestamps. The view feeds it the cell under the pointer; it answers with actions.
 *
 * - tap: press and release on the same cell without leaving it.
 * - double: a tap that starts within `doubleMs` of the previous tap ending, on the same cell.
 *   The first tap has already been acted on; the session replaces it.
 * - drag: the pointer left the cell it was pressed on. Every cell crossed is reported once,
 *   with gaps from fast swipes filled in along a straight line.
 */
export type GestureAction =
  | { type: 'tap'; cell: number }
  | { type: 'double'; cell: number }
  | { type: 'dragStart'; cell: number }
  | { type: 'dragTo'; cells: number[] }
  | { type: 'dragEnd' };

export const DOUBLE_TAP_MS = 300;

/** Cells on the straight line from a to b (excluding a, including b). */
export function lineCells(n: number, a: number, b: number): number[] {
  let r0 = Math.floor(a / n);
  let c0 = a % n;
  const r1 = Math.floor(b / n);
  const c1 = b % n;
  const dr = Math.abs(r1 - r0);
  const dc = Math.abs(c1 - c0);
  const sr = r0 < r1 ? 1 : -1;
  const sc = c0 < c1 ? 1 : -1;
  let err = dc - dr;
  const out: number[] = [];
  while (r0 !== r1 || c0 !== c1) {
    const e2 = 2 * err;
    if (e2 > -dr) {
      err -= dr;
      c0 += sc;
    }
    if (e2 < dc) {
      err += dc;
      r0 += sr;
    }
    out.push(r0 * n + c0);
  }
  return out;
}

export class Gestures {
  private readonly n: number;
  private readonly doubleMs: number;
  private press = -1;
  private pressT = 0;
  private dragging = false;
  private last = -1;
  private visited = new Set<number>();
  private lastTap: { cell: number; t: number } | null = null;

  constructor(n: number, doubleMs = DOUBLE_TAP_MS) {
    this.n = n;
    this.doubleMs = doubleMs;
  }

  get active(): boolean {
    return this.press >= 0;
  }

  down(cell: number, t: number): GestureAction[] {
    const out = this.press >= 0 ? this.cancel() : [];
    if (cell < 0) return out;
    this.press = cell;
    this.pressT = t;
    this.dragging = false;
    this.last = cell;
    return out;
  }

  move(cell: number): GestureAction[] {
    if (this.press < 0 || cell < 0 || cell === this.last) return [];
    const out: GestureAction[] = [];
    if (!this.dragging) {
      this.dragging = true;
      this.lastTap = null;
      this.visited = new Set([this.press]);
      out.push({ type: 'dragStart', cell: this.press });
    }
    const cells = lineCells(this.n, this.last, cell).filter((c) => !this.visited.has(c));
    for (const c of cells) this.visited.add(c);
    this.last = cell;
    if (cells.length) out.push({ type: 'dragTo', cells });
    return out;
  }

  up(t: number): GestureAction[] {
    if (this.press < 0) return [];
    const cell = this.press;
    this.press = -1;
    if (this.dragging) {
      this.dragging = false;
      return [{ type: 'dragEnd' }];
    }
    const prev = this.lastTap;
    if (prev && prev.cell === cell && this.pressT - prev.t <= this.doubleMs) {
      this.lastTap = null;
      return [{ type: 'double', cell }];
    }
    this.lastTap = { cell, t };
    return [{ type: 'tap', cell }];
  }

  cancel(): GestureAction[] {
    const wasDragging = this.dragging;
    this.press = -1;
    this.dragging = false;
    return wasDragging ? [{ type: 'dragEnd' }] : [];
  }

  /** Forget the previous tap (after undo, a hint, or anything else that changes the board). */
  forgetTap(): void {
    this.lastTap = null;
  }
}
