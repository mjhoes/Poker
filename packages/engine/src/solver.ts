import { validateHand } from "./cards";
import { getGameFamily } from "./families";
import { lookupTable } from "./evaluator";
import type { Card, GameFamilyId, Hand, HandAnalysis, HoldResult, ValueVector } from "./types";

export function validateValueVector(vector: ValueVector, familyId: GameFamilyId): void {
  const family = getGameFamily(familyId);
  if (vector.length !== family.handRanks.length ||
      Array.from(vector).some(value => !Number.isFinite(value) || value < 0)) {
    throw new RangeError(`Expected ${family.handRanks.length} finite, nonnegative values for ${familyId}.`);
  }
  if (vector[family.handRanks.indexOf("NOTHING")] !== 0) {
    throw new RangeError("The NOTHING rank must have value zero.");
  }
}

/**
 * Exact naive enumeration, with all 32 holds counted in one traversal.
 *
 * Every five-card final hand has a unique intersection with the original deal.
 * That intersection is exactly its hold mask; all other cards come from the 47
 * undealt cards. Bucketing all C(52,5) finals this way is identical to separately
 * enumerating C(47,5-popcount(mask)) draws for each hold. No discards are redrawn.
 * This is NOT the subset/inclusion–exclusion solver reserved for Prompt 3.
 *
 * Values and EVs use the caller's payout units (normally total coins returned).
 * Family defaults to JoB; explicitly pass the family for every other game.
 * Semantic category labeling is intentionally deferred to Prompt 4.
 */
export function analyzeHand(
  cards: readonly Card[],
  valueVector: ValueVector,
  familyId: GameFamilyId = "jacks_or_better",
): HandAnalysis {
  validateHand(cards);
  validateValueVector(valueVector, familyId);
  const family = getGameFamily(familyId);
  const table = lookupTable(familyId);
  const width = family.handRanks.length;
  const counts = new Uint32Array(32 * width);
  const cardBits = new Uint8Array(52);
  cards.forEach((card, i) => { cardBits[card] = 1 << i; });
  let index = 0;
  for (let e = 4; e < 52; e++) {
    const eMask = cardBits[e];
    for (let d = 3; d < e; d++) {
      const dMask = eMask | cardBits[d];
      for (let c = 2; c < d; c++) {
        const cMask = dMask | cardBits[c];
        for (let b = 1; b < c; b++) {
          const bMask = cMask | cardBits[b];
          for (let a = 0; a < b; a++) {
            const mask = bMask | cardBits[a];
            counts[mask * width + table[index++]]++;
          }
        }
      }
    }
  }
  const results: HoldResult[] = [];
  for (let mask = 0; mask < 32; mask++) {
    const rankCounts = Array.from(counts.subarray(mask * width, (mask + 1) * width));
    const drawCount = rankCounts.reduce((sum, count) => sum + count, 0);
    const total = rankCounts.reduce((sum, count, rank) => sum + count * valueVector[rank], 0);
    results.push({
      mask, ev: total / drawCount, rankCounts, drawCount,
      rankDist: rankCounts.map(count => count / drawCount),
    });
  }
  // Deterministic ordering only, not a claimed unique best strategy in an EV tie.
  results.sort((a, b) => b.ev - a.ev || a.mask - b.mask);
  return {
    familyId,
    hand: [...cards] as unknown as Hand,
    results,
    best: results[0],
    gapToSecond: results[0].ev - results[1].ev,
  };
}
