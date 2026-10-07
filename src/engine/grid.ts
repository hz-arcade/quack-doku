/**
 * Board geometry shared by the solver, the generator, the hint engine and the UI.
 *
 * Cells are numbered row-major (`cell = row * n + col`). A puzzle has 3n units: rows
 * 0..n-1, columns n..2n-1 and regions 2n..3n-1. Each needs exactly one duck. A duck "sees"
 * every other cell in its row, column and region plus its eight neighbours; no second duck
 * may sit on a cell it sees.
 */

/** Cell marks. A candidate is a cell that could still hold a duck. */
export const CAND = 0;
export const X = 1;
export const DUCK = 2;

export const ROW = 0;
export const COL = 1;
export const REGION = 2;
export type UnitKind = typeof ROW | typeof COL | typeof REGION;

export const MIN_N = 4;
export const MAX_N = 10;

export interface Geo {
  readonly n: number;
  readonly size: number;
  /** Region index of every cell. */
  readonly region: Uint8Array;
  /** Cells of each of the 3n units. */
  readonly units: readonly Int16Array[];
  /** `cellUnits[cell * 3 + kind]` is the unit index of that cell's row, column or region. */
  readonly cellUnits: Uint8Array;
  /** Cells each cell sees (excluding itself). */
  readonly sees: readonly Int16Array[];
  /** The same as a 128-bit set: four 32-bit words per cell. */
  readonly seesBits: Uint32Array;
}

export function unitKind(geo: Geo, u: number): UnitKind {
  return Math.floor(u / geo.n) as UnitKind;
}

export function unitIndex(geo: Geo, u: number): number {
  return u % geo.n;
}

export function rowOf(n: number, cell: number): number {
  return Math.floor(cell / n);
}

export function colOf(n: number, cell: number): number {
  return cell % n;
}

/** Whether two different cells see each other. */
export function touches(geo: Geo, a: number, b: number): boolean {
  return (geo.seesBits[a * 4 + (b >> 5)]! & (1 << (b & 31))) !== 0;
}

export function makeGeo(n: number, region: ArrayLike<number>): Geo {
  const size = n * n;
  const reg = Uint8Array.from(region);
  if (reg.length !== size) throw new Error(`expected ${size} cells, got ${reg.length}`);
  const lists: number[][] = Array.from({ length: 3 * n }, () => []);
  const cellUnits = new Uint8Array(size * 3);
  for (let c = 0; c < size; c++) {
    const r = Math.floor(c / n);
    const k = c % n;
    const g = reg[c]!;
    if (g >= n) throw new Error(`region ${g} out of range`);
    lists[r]!.push(c);
    lists[n + k]!.push(c);
    lists[2 * n + g]!.push(c);
    cellUnits[c * 3] = r;
    cellUnits[c * 3 + 1] = n + k;
    cellUnits[c * 3 + 2] = 2 * n + g;
  }
  const seesBits = new Uint32Array(size * 4);
  const sees: Int16Array[] = [];
  for (let a = 0; a < size; a++) {
    const ra = Math.floor(a / n);
    const ka = a % n;
    const list: number[] = [];
    for (let b = 0; b < size; b++) {
      if (a === b) continue;
      const rb = Math.floor(b / n);
      const kb = b % n;
      if (ra === rb || ka === kb || reg[a] === reg[b] || (Math.abs(ra - rb) <= 1 && Math.abs(ka - kb) <= 1)) {
        list.push(b);
        seesBits[a * 4 + (b >> 5)]! |= 1 << (b & 31);
      }
    }
    sees.push(Int16Array.from(list));
  }
  return { n, size, region: reg, units: lists.map((l) => Int16Array.from(l)), cellUnits, sees, seesBits };
}

/** Cells next to `cell` (4-neighbourhood), used for region connectivity. */
export function orthoNeighbours(n: number, cell: number): number[] {
  const r = Math.floor(cell / n);
  const k = cell % n;
  const out: number[] = [];
  if (r > 0) out.push(cell - n);
  if (r < n - 1) out.push(cell + n);
  if (k > 0) out.push(cell - 1);
  if (k < n - 1) out.push(cell + 1);
  return out;
}
