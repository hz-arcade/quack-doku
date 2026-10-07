import { clashes, crowdedUnits } from '../engine/board.ts';
import { DUCK, X, type Geo } from '../engine/grid.ts';
import { t } from '../i18n';
import { duckSvg, setDuckVariant, type DuckVariant } from './duckArt.ts';
import { make } from './dom.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** What a hint wants to show on the board. */
export interface BoardHighlight {
  /** Cells of the units the hint talks about (the rest of the board dims). */
  focus?: readonly number[];
  /** Cells to cross out. */
  elim?: readonly number[];
  /** Cell to put a duck on. */
  place?: number;
  /** Wrong marks. */
  wrong?: readonly number[];
  /** What-if: the assumed cell and the numbered chain of forced ducks. */
  assume?: number;
  chain?: readonly number[];
}

/**
 * The board: a CSS grid of cells with one SVG overlay drawing the region walls. Cells are
 * updated in place; only the cells that changed are touched.
 */
export class BoardView {
  readonly el: HTMLDivElement;
  private geo: Geo | null = null;
  private colours: number[] = [];
  private cells: HTMLDivElement[] = [];
  private ducks = new Map<number, SVGSVGElement>();
  private cursor = -1;
  private highlight: BoardHighlight | null = null;

  constructor() {
    this.el = make('div', 'board');
    this.el.setAttribute('role', 'grid');
    this.el.tabIndex = 0;
  }

  get n(): number {
    return this.geo?.n ?? 0;
  }

  setPuzzle(geo: Geo, colours: number[]): void {
    this.geo = geo;
    this.colours = colours;
    this.ducks.clear();
    this.cursor = -1;
    this.highlight = null;
    const n = geo.n;
    this.el.style.setProperty('--n', String(n));
    this.el.setAttribute('aria-label', t('aria.board', { n }));
    const grid = make('div', 'cells');
    this.cells = [];
    for (let r = 0; r < n; r++) {
      const row = make('div', 'brow');
      row.setAttribute('role', 'row');
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const cell = make('div', 'cell');
        cell.setAttribute('role', 'gridcell');
        const colour = colours[geo.region[i]!]!;
        cell.style.setProperty('--c', `var(--r${colour})`);
        cell.dataset.p = String(colour);
        cell.dataset.cell = String(i);
        cell.appendChild(make('span', 'mark'));
        row.appendChild(cell);
        this.cells.push(cell);
      }
      grid.appendChild(row);
    }
    this.el.replaceChildren(grid, this.walls(geo));
  }

  /** Region walls (thick), grid lines (thin) and the rounded frame, in cell units. */
  private walls(geo: Geo): SVGSVGElement {
    const n = geo.n;
    const thick: string[] = [];
    const thin: string[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const g = geo.region[r * n + c];
        if (c < n - 1) (geo.region[r * n + c + 1] !== g ? thick : thin).push(`M${c + 1} ${r}V${r + 1}`);
        if (r < n - 1) (geo.region[(r + 1) * n + c] !== g ? thick : thin).push(`M${c} ${r + 1}H${c + 1}`);
      }
    }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'walls');
    svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = (d: string, cls: string) => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', cls);
      return p;
    };
    const frame = document.createElementNS(SVG_NS, 'rect');
    frame.setAttribute('class', 'frame');
    frame.setAttribute('x', '0');
    frame.setAttribute('y', '0');
    frame.setAttribute('width', String(n));
    frame.setAttribute('height', String(n));
    svg.append(path(thin.join(''), 'thin'), path(thick.join(''), 'thick'), frame);
    return svg;
  }

  /** Redraw marks. `cells` limits the work to cells that changed (null: all). */
  render(marks: Uint8Array, derived: Uint8Array, cells: readonly number[] | null): void {
    const geo = this.geo;
    if (!geo) return;
    const list = cells ?? [...Array(geo.size).keys()];
    for (const i of list) this.renderCell(i, marks[i]!, derived[i]!);
    this.renderConflicts(marks);
  }

  private renderCell(i: number, mark: number, derived: number): void {
    const cell = this.cells[i]!;
    const isDuck = mark === DUCK;
    cell.classList.toggle('x', mark === X);
    cell.classList.toggle('ax', mark !== X && !isDuck && derived === 1);
    cell.classList.toggle('has-duck', isDuck);
    let duck = this.ducks.get(i);
    if (isDuck && !duck) {
      duck = duckSvg('normal');
      this.ducks.set(i, duck);
      cell.appendChild(duck);
      cell.classList.remove('pop');
      void cell.offsetWidth;
      cell.classList.add('pop');
    } else if (!isDuck && duck) {
      duck.remove();
      this.ducks.delete(i);
    }
    this.label(i, mark);
  }

  private label(i: number, mark: number): void {
    const geo = this.geo!;
    const n = geo.n;
    const colour = this.colours[geo.region[i]!]!;
    let s = t('aria.cell', { row: Math.floor(i / n) + 1, col: (i % n) + 1, color: t(`color.${colour}` as 'color.0') });
    if (mark === DUCK) s += t('aria.cell.duck');
    else if (mark === X) s += t('aria.cell.x');
    this.cells[i]!.setAttribute('aria-label', s);
  }

  /** Re-label every cell (after a language change). */
  relabel(marks: Uint8Array): void {
    if (!this.geo) return;
    this.el.setAttribute('aria-label', t('aria.board', { n: this.geo.n }));
    for (let i = 0; i < this.cells.length; i++) this.label(i, marks[i]!);
  }

  private renderConflicts(marks: Uint8Array): void {
    const geo = this.geo!;
    const bad = new Set<number>();
    for (const [a, b] of clashes(geo, marks)) {
      bad.add(a);
      bad.add(b);
    }
    const crowd = new Set<number>();
    for (const u of crowdedUnits(geo, marks)) for (const c of geo.units[u]!) crowd.add(c);
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]!;
      const clash = bad.has(i);
      cell.classList.toggle('clash', clash);
      cell.classList.toggle('crowd', crowd.has(i));
      const duck = this.ducks.get(i);
      if (duck && !cell.classList.contains('won')) setDuckVariant(duck, clash ? 'worried' : 'normal');
    }
  }

  cellAt(clientX: number, clientY: number): number {
    const n = this.n;
    if (!n) return -1;
    const r = this.el.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return -1;
    return Math.floor(y * n) * n + Math.floor(x * n);
  }

  cellEl(i: number): HTMLDivElement | undefined {
    return this.cells[i];
  }

  setCursor(i: number): void {
    if (this.cursor >= 0) this.cells[this.cursor]?.classList.remove('cursor');
    this.cursor = i;
    if (i >= 0) {
      const cell = this.cells[i]!;
      cell.classList.add('cursor');
      this.el.setAttribute('aria-activedescendant', (cell.id ||= `cell-${i}`));
    }
  }

  setHighlight(h: BoardHighlight | null): void {
    this.highlight = h;
    this.el.classList.toggle('dim', !!h?.focus?.length);
    const focus = new Set(h?.focus ?? []);
    const elim = new Set(h?.elim ?? []);
    const wrong = new Set(h?.wrong ?? []);
    const chain = h?.chain ?? [];
    this.cells.forEach((cell, i) => {
      cell.classList.toggle('hl-focus', focus.has(i));
      cell.classList.toggle('hl-elim', elim.has(i));
      cell.classList.toggle('hl-wrong', wrong.has(i));
      cell.classList.toggle('hl-place', h?.place === i);
      cell.classList.toggle('hl-assume', h?.assume === i);
      const k = chain.indexOf(i);
      cell.classList.toggle('hl-chain', k >= 0);
      cell.querySelector('.ghost')?.remove();
      if (h?.place === i || h?.assume === i || k >= 0) {
        const ghost = duckSvg('normal', 'duck ghost');
        cell.appendChild(ghost);
      }
      if (k >= 0) cell.dataset.k = String(k + 1);
      else delete cell.dataset.k;
    });
  }

  get hasHighlight(): boolean {
    return this.highlight !== null;
  }

  /** Ducks bob in a wave from the top-left corner; returns the animation length in ms. */
  celebrate(): number {
    const n = this.n;
    let longest = 0;
    for (const [i, duck] of this.ducks) {
      const cell = this.cells[i]!;
      const delay = (Math.floor(i / n) + (i % n)) * 70;
      longest = Math.max(longest, delay);
      cell.style.setProperty('--delay', `${delay}ms`);
      cell.classList.add('won');
      setDuckVariant(duck, 'happy' as DuckVariant);
    }
    this.el.classList.add('solved');
    return longest + 900;
  }
}
