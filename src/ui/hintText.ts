import { COL, REGION, ROW, type Geo } from '../engine/grid.ts';
import type { Hint } from '../engine/hints.ts';
import type { Deduction } from '../engine/logic.ts';
import { list, plural, t, type StringKey } from '../i18n';
import type { BoardHighlight } from './boardView.ts';

export interface HintView {
  text: string;
  highlight: BoardHighlight | null;
  /** Whether "Show me" has something to do. */
  canApply: boolean;
}

const KIND_NAME = ['row', 'col', 'region'] as const;

function kindOf(geo: Geo, u: number): number {
  return Math.floor(u / geo.n);
}

function colourName(geo: Geo, colours: readonly number[], u: number): string {
  return t(`color.${colours[u % geo.n]!}` as StringKey);
}

/** Parameters naming a unit: {row}, {col} or {color}. */
function unitParams(geo: Geo, colours: readonly number[], u: number): Record<string, string | number> {
  const k = kindOf(geo, u);
  if (k === ROW) return { row: (u % geo.n) + 1 };
  if (k === COL) return { col: (u % geo.n) + 1 };
  return { color: colourName(geo, colours, u) };
}

/** "row 3", "the pink region" … (`cap`: sentence-initial form). */
export function unitName(geo: Geo, colours: readonly number[], u: number, cap = false): string {
  const key = `hint.${cap ? 'Unit' : 'unit'}.${KIND_NAME[kindOf(geo, u)]}` as StringKey;
  return t(key, unitParams(geo, colours, u));
}

function cellsOf(geo: Geo, units: readonly number[]): number[] {
  return units.flatMap((u) => Array.from(geo.units[u]!));
}

function numbers(geo: Geo, units: readonly number[]): string {
  return list(units.map((u) => String((u % geo.n) + 1)));
}

function describeStep(geo: Geo, colours: readonly number[], d: Deduction): HintView {
  switch (d.tech) {
    case 'clear':
      return { text: t('hint.clear'), highlight: { focus: [d.duck, ...d.elim], elim: d.elim }, canApply: true };
    case 'single': {
      const key = `hint.single.${KIND_NAME[kindOf(geo, d.unit)]}` as StringKey;
      return { text: t(key, unitParams(geo, colours, d.unit)), highlight: { focus: cellsOf(geo, [d.unit]), place: d.place }, canApply: true };
    }
    case 'confine': {
      const a = KIND_NAME[kindOf(geo, d.unit)]!;
      const b = KIND_NAME[kindOf(geo, d.into)]!;
      const key = `hint.confine.${a}${b[0]!.toUpperCase()}${b.slice(1)}` as StringKey;
      const params = { ...unitParams(geo, colours, d.unit), ...unitParams(geo, colours, d.into) };
      return { text: t(key, params), highlight: { focus: cellsOf(geo, [d.unit, d.into]), elim: d.elim }, canApply: true };
    }
    case 'block': {
      const key = `hint.block.${KIND_NAME[kindOf(geo, d.unit)]}` as StringKey;
      return { text: t(key, unitParams(geo, colours, d.unit)), highlight: { focus: [...cellsOf(geo, [d.unit]), ...d.elim], elim: d.elim }, canApply: true };
    }
    case 'pigeon': {
      const a = kindOf(geo, d.units[0]!);
      const b = kindOf(geo, d.into[0]!);
      const plural3 = { [ROW]: 'rows', [COL]: 'cols', [REGION]: 'regions' } as Record<number, string>;
      const tail = plural3[b]!;
      const key = `hint.pigeon.${plural3[a]}${tail[0]!.toUpperCase()}${tail.slice(1)}` as StringKey;
      const params: Record<string, string | number> = { k: d.units.length };
      for (const [units, kind] of [
        [d.units, a],
        [d.into, b],
      ] as const) {
        if (kind === ROW) params.rows = numbers(geo, units);
        else if (kind === COL) params.cols = numbers(geo, units);
        else params.colors = list(units.map((u) => colourName(geo, colours, u)));
      }
      return { text: t(key, params), highlight: { focus: cellsOf(geo, d.units), elim: d.elim }, canApply: true };
    }
    case 'whatif': {
      const chain = d.chain
        .map((_, j) => t('hint.chain.step', { unit: unitName(geo, colours, d.chainUnits[j]!, true), k: j + 1 }))
        .join('');
      return {
        text: t('hint.whatif', { chain, broken: unitName(geo, colours, d.broken) }),
        highlight: { focus: [...cellsOf(geo, [d.broken]), d.assume, ...d.chain], assume: d.assume, chain: d.chain, elim: d.elim },
        canApply: true,
      };
    }
  }
}

export function describeHint(h: Hint, geo: Geo, colours: readonly number[]): HintView {
  if (h.kind === 'done') return { text: t('hint.done'), highlight: null, canApply: false };
  if (h.kind === 'mistakes') {
    if (!h.cells.length) return { text: plural('hint.mistakes', h.count), highlight: null, canApply: false };
    return { text: t('hint.mistakes.shown'), highlight: { wrong: h.cells }, canApply: true };
  }
  return describeStep(geo, colours, h.step.d);
}
