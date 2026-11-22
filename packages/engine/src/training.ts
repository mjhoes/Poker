import { getCanonicalHands } from "./canonical";
import { DRAW_COUNTS, fillFastCounts } from "./fast-solver";
import { describeHoldUnchecked, refinementKey } from "./labels";
import { getSubsetTables } from "./subsets";
import { ENGINE_VERSION } from "./game-analysis";
import type { GameAnalysis } from "./game-analysis";

export interface TrainingData {
  readonly evs: Float64Array;
  readonly labels: readonly [Uint16Array, Uint16Array, Uint16Array];
  readonly names: readonly [readonly string[], readonly string[], readonly string[]];
}

export class TrainingContext {
  private data?: TrainingData;
  constructor(readonly key: string, readonly analysis: GameAnalysis) {
    if (!key || analysis.engineVersion !== ENGINE_VERSION || analysis.perHand.size !== 134459) {
      throw new Error("Register a current, complete game analysis with a nonempty analysis key.");
    }
  }

  getData(): TrainingData {
    if (this.data) return this.data;
    const hands = getCanonicalHands();
    const tables = getSubsetTables(this.analysis.familyId);
    const scratch = new Int32Array(32 * tables.width);
    const evs = new Float64Array(hands.length * 32);
    const labels: [Uint16Array, Uint16Array, Uint16Array] = [new Uint16Array(evs.length), new Uint16Array(evs.length), new Uint16Array(evs.length)];
    const names: [string[], string[], string[]] = [[], [], []];
    const dictionaries = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
    for (let h = 0; h < hands.length; h++) {
      const { hand, id } = hands[h];
      if (!this.analysis.perHand.has(id)) throw new Error("Training analysis has missing canonical hands.");
      fillFastCounts(hand, tables, scratch);
      for (let mask = 0; mask < 32; mask++) {
        const index = h * 32 + mask;
        let sum = 0;
        for (let rank = 0; rank < tables.width; rank++) sum += scratch[mask * tables.width + rank] * this.analysis.valueVector[rank];
        evs[index] = sum / DRAW_COUNTS[mask];
        const pattern = describeHoldUnchecked(hand, mask, this.analysis.familyId);
        for (let level = 0; level <= 2; level++) {
          const name = refinementKey(pattern, level);
          let code = dictionaries[level].get(name);
          if (code === undefined) {
            code = names[level].length;
            if (code >= 65536) throw new Error("Label vocabulary exceeds the training index capacity.");
            dictionaries[level].set(name, code);
            names[level].push(name);
          }
          labels[level][index] = code;
        }
      }
    }
    this.data = { evs, labels, names };
    return this.data;
  }
}

const registry = new Map<string, TrainingContext>();
export function registerTrainingAnalysis(key: string, analysis: GameAnalysis): TrainingContext {
  const existing = registry.get(key);
  if (existing) {
    if (existing.analysis.familyId !== analysis.familyId || existing.analysis.betCoins !== analysis.betCoins ||
        JSON.stringify(existing.analysis.valueVector) !== JSON.stringify(analysis.valueVector)) {
      throw new Error("Analysis key is already registered for different payout data.");
    }
    return existing;
  }
  const context = new TrainingContext(key, analysis);
  registry.set(key, context);
  return context;
}
export function getTrainingContext(key: string): TrainingContext {
  const context = registry.get(key);
  if (!context) throw new Error(`No training analysis registered for ${key}`);
  return context;
}
export function clearTrainingCache(key?: string): void {
  if (key === undefined) registry.clear();
  else registry.delete(key);
}
