import { validateHand } from "./cards";
import { choose, COMBINATIONS } from "./combinations";
import { getSubsetTables, subsetOffset } from "./subsets";
import { validateValueVector } from "./solver";
import { describeHoldUnchecked } from "./labels";
import type { SubsetTables } from "./subsets";
import type { Card, GameFamilyId, Hand, HandAnalysis, HoldResult, ValueVector } from "./types";

export const DRAW_COUNTS = Int32Array.from({ length: 32 }, (_, mask) => {
  let held = 0;
  for (let bit = mask; bit; bit &= bit - 1) held++;
  return choose(47, 5 - held);
});

/** Internal allocation-free kernel. cards must already be sorted and valid. */
export function fillFastCounts(cards: readonly Card[], tables: SubsetTables, scratch: Int32Array): void {
  const { counts, finals, width } = tables;
  for (let mask = 0; mask < 32; mask++) {
    let size = 0, index = 0;
    for (let bit = 0; bit < 5; bit++) {
      if (mask & (1 << bit)) index += COMBINATIONS[++size][cards[bit]];
    }
    const row = mask * width;
    if (size === 5) {
      scratch.fill(0, row, row + width);
      scratch[row + finals[index]] = 1;
    } else {
      const source = subsetOffset(size, index, width);
      for (let rank = 0; rank < width; rank++) scratch[row + rank] = counts[source + rank];
    }
  }
  // Superset Möbius transform: T[H] minus all hands containing any discard.
  for (let bit = 1; bit < 32; bit <<= 1) {
    for (let mask = 0; mask < 32; mask++) {
      if (mask & bit) continue;
      const target = mask * width, source = (mask | bit) * width;
      for (let rank = 0; rank < width; rank++) scratch[target + rank] -= scratch[source + rank];
    }
  }
}

export function analyzeHandFast(
  cards: readonly Card[],
  valueVector: ValueVector,
  familyId: GameFamilyId = "jacks_or_better",
): HandAnalysis {
  validateHand(cards);
  validateValueVector(valueVector, familyId);
  const tables = getSubsetTables(familyId);
  const order = [0, 1, 2, 3, 4].sort((a, b) => cards[a] - cards[b]);
  const sorted = order.map(i => cards[i]);
  const scratch = new Int32Array(32 * tables.width);
  fillFastCounts(sorted, tables, scratch);
  const results: HoldResult[] = [];
  for (let sortedMask = 0; sortedMask < 32; sortedMask++) {
    let mask = 0;
    order.forEach((original, sortedPosition) => {
      if (sortedMask & (1 << sortedPosition)) mask |= 1 << original;
    });
    const rankCounts = Array.from(scratch.subarray(sortedMask * tables.width, (sortedMask + 1) * tables.width));
    const drawCount = DRAW_COUNTS[sortedMask];
    const total = rankCounts.reduce((sum, count, rank) => sum + count * valueVector[rank], 0);
    results.push({ mask, label: describeHoldUnchecked(cards, mask, familyId).label, ev: total / drawCount, rankCounts, drawCount, rankDist: rankCounts.map(count => count / drawCount) });
  }
  results.sort((a, b) => b.ev - a.ev || a.mask - b.mask);
  return { familyId, valueVector: [...valueVector], hand: [...cards] as unknown as Hand, results, best: results[0], gapToSecond: results[0].ev - results[1].ev };
}
