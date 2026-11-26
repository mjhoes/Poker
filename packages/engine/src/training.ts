import { getCanonicalHands } from "./canonical";
import { DRAW_COUNTS, fillFastCounts } from "./fast-solver";
import { describeHoldUnchecked, refinementKey, STRAIGHT_WINDOWS } from "./labels";
import type { HoldPattern } from "./labels";
import { getSubsetTables } from "./subsets";
import { ENGINE_VERSION } from "./game-analysis";
import type { GameAnalysis } from "./game-analysis";
import type { GameFamilyId } from "./types";
import { canonicalMaskOrder, holdPreference } from "./hold-policy";

export interface TrainingData {
  readonly evs: Float64Array;
  readonly preferences: Float64Array;
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
    const preferences = new Float64Array(evs.length);
    const labels: [Uint16Array, Uint16Array, Uint16Array] = [new Uint16Array(evs.length), new Uint16Array(evs.length), new Uint16Array(evs.length)];
    const names: [string[], string[], string[]] = [[], [], []];
    const dictionaries = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
    // A hold's preference and codes depend only on what's held (its category and ranks) and two counts from the
    // discards (its flush and straight penalties): `trainingPattern` describes each held set once and counts the
    // penalties per deal. Each distinct pattern gets a slot holding its preference and its code at each level; codes
    // are handed out in the same order as before.
    const held = new Map<number, HeldShape>();
    const slots = new Map<number, number>();
    const slotPreference: number[] = [], slotCodes: number[] = [];
    for (let h = 0; h < hands.length; h++) {
      const { hand, id } = hands[h];
      if (!this.analysis.perHand.has(id)) throw new Error("Training analysis has missing canonical hands.");
      fillFastCounts(hand, tables, scratch);
      const maskOrder = canonicalMaskOrder(hand);
      for (let mask = 0; mask < 32; mask++) {
        const index = h * 32 + mask;
        let sum = 0;
        for (let rank = 0; rank < tables.width; rank++) sum += scratch[mask * tables.width + rank] * this.analysis.valueVector[rank];
        evs[index] = sum / DRAW_COUNTS[mask];
        const { shape, flushPenalty, straightPenalty } = trainingShape(hand, mask, this.analysis.familyId, held);
        const key = shape.slot * 36 + flushPenalty * 6 + straightPenalty;
        let slot = slots.get(key);
        if (slot === undefined) {
          slot = slotPreference.length;
          slots.set(key, slot);
          const pattern = patternOf(shape, flushPenalty, straightPenalty);
          slotPreference.push(holdPreference(pattern));
          for (let level = 0; level <= 2; level++) {
            if (level === 2 && !dictionaries[2].has(pattern.base)) {
              dictionaries[2].set(pattern.base, names[2].length);
              names[2].push(pattern.base);
            }
            const name = refinementKey(pattern, level);
            let code = dictionaries[level].get(name);
            if (code === undefined) {
              code = names[level].length;
              if (code >= 65536) throw new Error("Label vocabulary exceeds the training index capacity.");
              dictionaries[level].set(name, code);
              names[level].push(name);
            }
            slotCodes.push(code);
          }
        }
        preferences[index] = slotPreference[slot] * 32 + 31 - maskOrder[mask];
        labels[0][index] = slotCodes[slot * 3]; labels[1][index] = slotCodes[slot * 3 + 1]; labels[2][index] = slotCodes[slot * 3 + 2];
      }
    }
    this.data = { evs, preferences, labels, names };
    return this.data;
  }
}

/**
 * What a hold's training pattern takes from its held cards alone: the category and held ranks (from one full
 * description), whether it's a draw, and the ranks that would complete a straight with it. (Which suit its natural
 * cards share differs from deal to deal, so it's read per deal.) `slot` numbers it among the held sets seen.
 */
export type HeldShape = { slot: number; base: string; heldRanks: string; highCards: number; wilds: number; draw: boolean; outs: number };
/**
 * A hold's training pattern as `describeHoldUnchecked` gives it (category, label, held ranks and both penalties), with
 * the held set described once per `cache` (keyed by its sorted ranks and suitedness) and the penalties counted from
 * the discards exactly as `describeHoldUnchecked` counts them.
 */
export function trainingShape(hand: readonly number[], mask: number, familyId: GameFamilyId, cache: Map<number, HeldShape>) {
  const wildDeuces = familyId === "deuces_wild";
  let count = 0, natural = -1, suited = 1, key = 0;
  for (let i = 0; i < 5; i++) {
    if (!(mask & (1 << i))) continue;
    const card = hand[i], rank = card >> 2;
    count++;
    if (wildDeuces && rank === 0) continue;
    if (natural < 0) natural = card & 3; else if ((card & 3) !== natural) suited = 0;
  }
  // Held ranks as a multiset (5 bits of count room per rank is more than enough), with suitedness and the count.
  for (let i = 0; i < 5; i++) if (mask & (1 << i)) key += 8 ** (hand[i] >> 2);
  key = (key * 2 + suited) * 8 + count;
  let shape = cache.get(key);
  if (!shape) {
    const pattern = describeHoldUnchecked(hand, mask, familyId);
    let bits = 0, unique = true, n = 0;
    for (let i = 0; i < 5; i++) {
      if (!(mask & (1 << i))) continue;
      n++;
      const rank = hand[i] >> 2;
      if (wildDeuces && rank === 0) continue;
      if (bits & (1 << rank)) unique = false;
      bits |= 1 << rank;
    }
    const windows = unique ? STRAIGHT_WINDOWS.filter(window => (bits & ~window) === 0) : [];
    shape = {
      slot: cache.size, base: pattern.base, heldRanks: pattern.heldRanks, highCards: pattern.highCards, wilds: pattern.wilds,
      draw: unique && bits !== 0 && n > 0 && n < 5,
      outs: windows.reduce((union, window) => union | window, 0) & ~bits,
    };
    cache.set(key, shape);
  }
  let flushPenalty = 0, straightPenalty = 0;
  const suit = suited && natural >= 0 ? natural : -1;
  if (shape.draw) {
    for (let i = 0; i < 5; i++) {
      if (mask & (1 << i)) continue;
      const card = hand[i];
      if (suit >= 0 && (card & 3) === suit && !(wildDeuces && card >> 2 === 0)) flushPenalty++;
      if (shape.outs & (1 << (card >> 2))) straightPenalty++;
    }
  }
  return { shape, flushPenalty, straightPenalty };
}
/** The pattern fields training reads, from a held shape and its penalties. */
export function patternOf(shape: HeldShape, flushPenalty: number, straightPenalty: number): HoldPattern {
  const penalties = [flushPenalty ? "flush" : "", straightPenalty ? "straight" : ""].filter(Boolean);
  return {
    base: shape.base, label: shape.base + (penalties.length ? `|pen:${penalties.join(",")}` : ""), heldRanks: shape.heldRanks,
    discardedRanks: "", highCards: shape.highCards, wilds: shape.wilds, flushPenalty, straightPenalty,
  };
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
