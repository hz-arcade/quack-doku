import { CAND, DUCK, X, type Geo } from './grid.ts';

/** One undo step: the cells it touched and what they held before. */
interface Entry {
  cells: number[];
  before: number[];
}

/**
 * The player's marks with grouped undo. A drag or a double-tap is one undo step: open a
 * group with begin(), make changes, close it with end().
 */
export class Board {
  readonly n: number;
  readonly marks: Uint8Array;
  private stack: Entry[] = [];
  private group: Entry | null = null;

  constructor(n: number, marks?: Uint8Array) {
    this.n = n;
    this.marks = marks ? marks.slice() : new Uint8Array(n * n);
  }

  get undoDepth(): number {
    return this.stack.length;
  }

  begin(): void {
    if (!this.group) this.group = { cells: [], before: [] };
  }

  end(): void {
    const g = this.group;
    this.group = null;
    if (g && g.cells.length) this.stack.push(g);
    if (this.stack.length > 500) this.stack.splice(0, this.stack.length - 500);
  }

  /** Set one cell. Returns whether anything changed. */
  set(cell: number, value: number): boolean {
    const old = this.marks[cell]!;
    if (old === value) return false;
    const solo = !this.group;
    if (solo) this.begin();
    const g = this.group!;
    if (!g.cells.includes(cell)) {
      g.cells.push(cell);
      g.before.push(old);
    }
    this.marks[cell] = value;
    if (solo) this.end();
    return true;
  }

  /** Revert the last step. Returns the cells it touched, or null with nothing to undo. */
  undo(): number[] | null {
    this.end();
    const e = this.stack.pop();
    if (!e) return null;
    for (let i = e.cells.length - 1; i >= 0; i--) this.marks[e.cells[i]!] = e.before[i]!;
    return e.cells;
  }

  /** Clear the board as one undoable step. */
  reset(): number[] {
    this.begin();
    const touched: number[] = [];
    for (let c = 0; c < this.marks.length; c++) if (this.set(c, CAND)) touched.push(c);
    this.end();
    return touched;
  }

  clearHistory(): void {
    this.stack = [];
    this.group = null;
  }

  ducks(): number[] {
    const out: number[] = [];
    for (let c = 0; c < this.marks.length; c++) if (this.marks[c] === DUCK) out.push(c);
    return out;
  }

  /** '.' empty, 'x' crossed, 'D' duck. */
  serialize(): string {
    let s = '';
    for (const v of this.marks) s += v === DUCK ? 'D' : v === X ? 'x' : '.';
    return s;
  }

  static parse(n: number, s: string): Board | null {
    if (s.length !== n * n || !/^[.xD]*$/.test(s)) return null;
    const m = new Uint8Array(n * n);
    for (let i = 0; i < s.length; i++) m[i] = s[i] === 'D' ? DUCK : s[i] === 'x' ? X : CAND;
    return new Board(n, m);
  }
}

/** Cells seen by at least one duck: the automatic crosses when auto-X is on. */
export function seenByDucks(geo: Geo, marks: Uint8Array): Uint8Array {
  const out = new Uint8Array(geo.size);
  for (let c = 0; c < geo.size; c++) {
    if (marks[c] !== DUCK) continue;
    for (const s of geo.sees[c]!) out[s] = 1;
  }
  return out;
}

/** Pairs of ducks that break a rule (same row, column or region, or touching). */
export function clashes(geo: Geo, marks: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < geo.size; a++) {
    if (marks[a] !== DUCK) continue;
    for (const b of geo.sees[a]!) if (b > a && marks[b] === DUCK) out.push([a, b]);
  }
  return out;
}

/** Units (row/column/region indices into geo.units) holding two or more ducks. */
export function crowdedUnits(geo: Geo, marks: Uint8Array): number[] {
  const out: number[] = [];
  geo.units.forEach((cells, u) => {
    let k = 0;
    for (const c of cells) if (marks[c] === DUCK) k++;
    if (k > 1) out.push(u);
  });
  return out;
}

export function isSolved(geo: Geo, marks: Uint8Array): boolean {
  let k = 0;
  for (let c = 0; c < geo.size; c++) if (marks[c] === DUCK) k++;
  return k === geo.n && clashes(geo, marks).length === 0;
}
