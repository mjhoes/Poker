import { analyzeHandFast } from "@perfect-draw/engine";
import type { GameAnalysis, Hand } from "@perfect-draw/engine";

/*
 * Where perfect strategy differs between two tables of the same game, over every possible deal. A deal counts as a
 * change only when no hold is optimal under both tables. Stored analyses keep just the best and second-best hold per
 * deal, so whenever either table has a tie there, the deal is re-solved exactly to get every optimal hold (three or
 * more holds can tie, e.g. a lone J, K or A toward a royal).
 */

const EPSILON = 1e-9;
type Analysis = Pick<GameAnalysis, "familyId" | "valueVector" | "perHand">;

function optimalHolds(hand: Hand, analysis: Analysis) {
  const results = analyzeHandFast(hand, analysis.valueVector, analysis.familyId).results;
  const best = Math.max(...results.map(row => row.ev));
  return new Set(results.filter(row => best - row.ev < EPSILON).map(row => row.mask));
}

/**
 * Whether perfect strategy changes on one deal between two tables of the same game: no hold is optimal under both.
 * Same stored best hold: no change. No tie on either side: the stored best holds decide. Otherwise only the tied
 * side(s) are re-solved to find every optimal hold. Null when the deal can't be compared (missing from either).
 */
export function bestHoldDiffers(id: number, mine: Analysis, base: Analysis, hands: ReadonlyMap<number, Hand>): boolean | null {
  const result = mine.perHand.get(id), other = base.perHand.get(id);
  if (!result || !other) return null;
  if (result.bestMask === other.bestMask) return false;
  const mineTied = result.ev - result.secondEv < EPSILON, baseTied = other.ev - other.secondEv < EPSILON;
  if (!mineTied && !baseTied) return true;
  const hand = hands.get(id);
  if (!hand) return null;
  const mineOptimal = mineTied ? optimalHolds(hand, mine) : new Set([result.bestMask]);
  const baseOptimal = baseTied ? optimalHolds(hand, base) : new Set([other.bestMask]);
  return ![...mineOptimal].some(mask => baseOptimal.has(mask));
}

export function compareStrategies(mine: Analysis, base: Analysis, hands: ReadonlyMap<number, Hand>, examples = 4) {
  if (mine.familyId !== base.familyId) throw new Error("Compare with a table of the same game.");
  let total = 0, differing = 0;
  const changes: { id: number; weight: number; best: string; baseBest: string }[] = [];
  for (const [id, result] of mine.perHand) {
    total += result.weight;
    const other = base.perHand.get(id);
    if (!other || !bestHoldDiffers(id, mine, base, hands)) continue;
    differing += result.weight;
    changes.push({ id, weight: result.weight, best: result.bestLabel, baseBest: other.bestLabel });
  }
  changes.sort((a, b) => b.weight - a.weight || a.id - b.id);
  return {
    differPct: total ? (differing / total) * 100 : 0,
    examples: changes.slice(0, examples).map(change => ({ hand: [...(hands.get(change.id) ?? [])], best: change.best, baseBest: change.baseBest, dealsPct: (change.weight / total) * 100 })),
  };
}
