import { getCanonicalHands } from "./canonical";
import { getTrainingContext } from "./training";
import type { TrainingContext } from "./training";
import type { Hand } from "./types";

export interface DrillOptions {
  readonly analysisKey: string;
  readonly targetPairs?: readonly { correct: string; confusedWith: string }[];
  readonly targetLabels?: readonly string[];
  /** Total-coin EV gap, inclusive. Zero requests exact ties. */
  readonly closeCallMaxGap?: number;
  readonly excludeRecent?: readonly number[];
  readonly sampling?: "real" | "canonical";
  readonly random?: () => number;
}
export interface DrillHand {
  readonly analysisKey: string;
  readonly canonicalHandId: number;
  readonly hand: Hand;
  readonly bestMask: number;
  readonly secondMask: number;
  readonly bestLabel: string;
  readonly secondLabel: string;
  readonly ev: number;
  readonly secondEv: number;
}

const indices = new WeakMap<TrainingContext, ReadonlyMap<string, readonly number[]>>();
function pairIndex(context: TrainingContext): ReadonlyMap<string, readonly number[]> {
  const previous = indices.get(context);
  if (previous) return previous;
  const result = new Map<string, number[]>();
  for (const [id, row] of context.analysis.perHand) {
    const keys = new Set([
      `${row.bestLabel}\t${row.secondLabel}`,
      `${row.bestLabel.split("|")[0]}\t${row.secondLabel.split("|")[0]}`,
      `${row.bestLabel}\t${row.secondLabel.split("|")[0]}`,
      `${row.bestLabel.split("|")[0]}\t${row.secondLabel}`,
    ]);
    for (const key of keys) {
      const ids = result.get(key) ?? [];
      ids.push(id); result.set(key, ids);
    }
  }
  indices.set(context, result);
  return result;
}

export function generateHand(options: DrillOptions): DrillHand {
  const context = getTrainingContext(options.analysisKey);
  if (options.closeCallMaxGap !== undefined && (!Number.isFinite(options.closeCallMaxGap) || options.closeCallMaxGap < 0)) {
    throw new RangeError("Close-call EV gap must be finite and nonnegative.");
  }
  if (options.sampling !== undefined && !["real", "canonical"].includes(options.sampling)) throw new Error("Unknown drill sampling mode.");
  if (options.targetPairs && (!options.targetPairs.length || options.targetPairs.some(pair => !pair.correct || !pair.confusedWith))) {
    throw new Error("Target pairs must contain nonempty category labels.");
  }
  if (options.targetLabels && (!options.targetLabels.length || options.targetLabels.some(label => !label))) throw new Error("Target labels must be nonempty.");
  const excluded = new Set(options.excludeRecent ?? []);
  let ids: readonly number[];
  if (options.targetPairs) {
    const index = pairIndex(context);
    ids = [...new Set(options.targetPairs.flatMap(pair => index.get(`${pair.correct}\t${pair.confusedWith}`) ?? []))];
  } else ids = getCanonicalHands().map(hand => hand.id);
  const candidates = ids.filter(id => {
    const row = context.analysis.perHand.get(id)!;
    return !excluded.has(id) && (!options.targetLabels || options.targetLabels.includes(row.bestLabel)) &&
      (options.closeCallMaxGap === undefined || row.ev - row.secondEv <= options.closeCallMaxGap);
  });
  if (!candidates.length) throw new Error("No drill hands satisfy the requested categories, gap, and exclusions.");
  const rng = () => {
    const value = (options.random ?? Math.random)();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError("Random source must return a value in [0, 1).");
    return value;
  };
  const weight = (id: number) => options.sampling === "canonical" ? 1 : context.analysis.perHand.get(id)!.weight;
  let ticket = rng() * candidates.reduce((sum, id) => sum + weight(id), 0);
  let id = candidates[candidates.length - 1];
  for (const candidate of candidates) { ticket -= weight(candidate); if (ticket < 0) { id = candidate; break; } }
  const canonical = getCanonicalHands().find(hand => hand.id === id)!;
  const row = context.analysis.perHand.get(id)!;
  const shuffle = <T,>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  const suits = shuffle([0, 1, 2, 3]);
  const positions = shuffle([0, 1, 2, 3, 4]);
  const remap = (mask: number) => positions.reduce((out, original, display) =>
    out | ((mask & (1 << original)) ? 1 << display : 0), 0);
  return {
    analysisKey: options.analysisKey, canonicalHandId: id,
    hand: positions.map(position => (canonical.hand[position] & ~3) + suits[canonical.hand[position] & 3]) as unknown as Hand,
    bestMask: remap(row.bestMask), secondMask: remap(row.secondMask),
    bestLabel: row.bestLabel, secondLabel: row.secondLabel, ev: row.ev, secondEv: row.secondEv,
  };
}
