import { getCanonicalHands } from "./canonical";
import { DRAW_COUNTS, fillFastCounts } from "./fast-solver";
import { getGameFamily } from "./families";
import { getSubsetTables } from "./subsets";
import { validateValueVector } from "./solver";
import { describeHoldUnchecked } from "./labels";
import type { GameFamilyId, ValueVector } from "./types";

export const ENGINE_VERSION = "2.0.0";

export interface GameHandResult {
  readonly weight: number;
  readonly bestMask: number;
  readonly secondMask: number;
  readonly bestLabel: string;
  readonly secondLabel: string;
  /** Total returned coins, in the supplied vector's units. */
  readonly ev: number;
  readonly secondEv: number;
}

export interface GameAnalysis {
  readonly engineVersion: string;
  readonly familyId: GameFamilyId;
  readonly valueVector: ValueVector;
  readonly betCoins: number;
  readonly returnPct: number;
  /** Single-line variance of the return per unit bet, not total-coin variance. */
  readonly variance: number;
  readonly hitFreq: number;
  readonly rankProbs: readonly number[];
  readonly perHand: ReadonlyMap<number, GameHandResult>;
}

export interface AnalysisProgress {
  readonly phase: "initializing" | "analyzing" | "complete";
  readonly completed: number;
  readonly total: number;
}

/**
 * Exact optimal single-line analysis. Coin normalization is explicit:
 * supply betCoins=5 when the vector contains five-coin payouts.
 * Multiplay covariance and semantic labels are outside this module's scope.
 */
export function analyzeGame(
  familyId: GameFamilyId,
  valueVector: ValueVector,
  onProgress?: (progress: AnalysisProgress) => void,
  options: { betCoins?: number } = {},
): GameAnalysis {
  validateValueVector(valueVector, familyId);
  const betCoins = options.betCoins ?? 1;
  if (!Number.isFinite(betCoins) || betCoins <= 0) throw new RangeError("betCoins must be finite and positive.");
  const vector = [...valueVector];
  onProgress?.({ phase: "initializing", completed: 0, total: 134459 });
  const family = getGameFamily(familyId);
  const tables = getSubsetTables(familyId);
  const hands = getCanonicalHands();
  const scratch = new Int32Array(32 * tables.width);
  const probabilities = new Float64Array(tables.width);
  const perHand = new Map<number, GameHandResult>();
  let meanCoins = 0;
  for (let index = 0; index < hands.length; index++) {
    const { id, hand, weight } = hands[index];
    fillFastCounts(hand, tables, scratch);
    let bestMask = -1, secondMask = -1;
    let bestEv = -Infinity, secondEv = -Infinity;
    for (let mask = 0; mask < 32; mask++) {
      let sum = 0;
      const row = mask * tables.width;
      for (let rank = 0; rank < tables.width; rank++) sum += scratch[row + rank] * vector[rank];
      const ev = sum / DRAW_COUNTS[mask];
      if (ev > bestEv) {
        secondEv = bestEv; secondMask = bestMask;
        bestEv = ev; bestMask = mask;
      } else if (ev > secondEv) {
        secondEv = ev; secondMask = mask;
      }
    }
    const frequency = weight / 2598960;
    meanCoins += bestEv * frequency;
    const scale = frequency / DRAW_COUNTS[bestMask];
    for (let rank = 0; rank < tables.width; rank++) probabilities[rank] += scratch[bestMask * tables.width + rank] * scale;
    perHand.set(id, {
      weight, bestMask, secondMask, ev: bestEv, secondEv,
      bestLabel: describeHoldUnchecked(hand, bestMask, familyId).label,
      secondLabel: describeHoldUnchecked(hand, secondMask, familyId).label,
    });
    if ((index + 1) % 2048 === 0) onProgress?.({ phase: "analyzing", completed: index + 1, total: hands.length });
  }
  let secondMoment = 0, hitFreq = 0;
  for (let rank = 0; rank < family.handRanks.length; rank++) {
    secondMoment += probabilities[rank] * (vector[rank] / betCoins) ** 2;
    if (vector[rank] > 0) hitFreq += probabilities[rank];
  }
  onProgress?.({ phase: "complete", completed: hands.length, total: hands.length });
  return {
    engineVersion: ENGINE_VERSION, familyId, valueVector: vector, betCoins,
    returnPct: 100 * meanCoins / betCoins,
    variance: Math.max(0, secondMoment - (meanCoins / betCoins) ** 2),
    hitFreq, rankProbs: Array.from(probabilities), perHand,
  };
}
