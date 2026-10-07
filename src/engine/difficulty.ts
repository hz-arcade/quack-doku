import type { Geo } from './grid.ts';
import { solveLogically, TIER, type FindOptions, type Step } from './logic.ts';

/**
 * Difficulty of one step: the technique's weight, discounted when several deductions of that
 * tier were available at once (lots of easy options feel easy; a single option at a
 * bottleneck is what makes a puzzle hard).
 */
export function stepWeight(n: number, s: Step): number {
  const d = s.d;
  let w: number;
  switch (d.tech) {
    case 'clear':
      return 0;
    case 'single':
      // A region with one free cell is easier to spot than a row or column with one.
      w = d.unit >= 2 * n ? 1 : 1.3;
      break;
    case 'confine':
      w = 2.5;
      break;
    case 'block':
      w = 4;
      break;
    case 'pigeon':
      w = 6 + 3 * (d.units.length - 2);
      break;
    case 'whatif':
      w = 12 + 3 * d.chain.length;
      break;
  }
  return w / Math.sqrt(s.options);
}

export interface Grade {
  solved: boolean;
  /** Hardest tier used (TIER.unsolved when the solve got stuck). */
  tier: number;
  /** Sum of step weights, rounded to one decimal. */
  score: number;
  whatifs: number;
  longestChain: number;
  steps: Step[];
}

export function grade(geo: Geo, opts: FindOptions = {}): Grade {
  const res = solveLogically(geo, opts);
  let tier = 0;
  let score = 0;
  let whatifs = 0;
  let longestChain = 0;
  for (const s of res.steps) {
    tier = Math.max(tier, s.tier);
    score += stepWeight(geo.n, s);
    if (s.d.tech === 'whatif') {
      whatifs++;
      longestChain = Math.max(longestChain, s.d.chain.length);
    }
  }
  return {
    solved: res.solved,
    tier: res.solved ? tier : TIER.unsolved,
    score: Math.round(score * 10) / 10,
    whatifs,
    longestChain,
    steps: res.steps,
  };
}
