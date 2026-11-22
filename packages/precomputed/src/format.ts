import { z } from "zod";
import { ENGINE_VERSION, getGameFamily, unpackHand } from "@perfect-draw/engine";
import { analysisKey } from "@perfect-draw/paytables";
import type { GameAnalysis, GameHandResult } from "@perfect-draw/engine";
import type { StrategyList } from "@perfect-draw/engine";

const finite = z.number().finite();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const familyId = z.enum(["jacks_or_better", "bonus_poker", "bonus_poker_deluxe", "double_bonus", "double_double_bonus", "deuces_wild"]);
const summaryShape = {
  familyId,
  valueVector: z.array(finite.nonnegative()),
  betCoins: finite.positive(),
  returnPct: finite.nonnegative(),
  variance: finite.nonnegative(),
  hitFreq: finite.min(0).max(1),
  rankProbs: z.array(finite.min(0).max(1)),
};

const handRow = z.tuple([
  z.number().int().nonnegative(), // canonical ID
  z.number().int().min(1).max(24), // multiplicity
  z.number().int().min(0).max(31), // best mask
  z.number().int().min(0).max(31), // second mask
  finite.nonnegative(), // best EV
  finite.nonnegative(), // second EV
  z.string().min(1).max(160), // best label
  z.string().min(1).max(160), // second label
]);

const strategySchema: z.ZodType<StrategyList> = z.object({
  analysisKey: hash,
  tier: z.enum(["Beginner", "Intermediate", "Expert", "Perfect"]),
  refinement: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  returnPct: finite.nonnegative(),
  costVsOptimal: finite.nonnegative(),
  optimalDecisionFreq: finite.min(0).max(1),
  lines: z.array(z.object({
    label: z.string().min(1),
    rank: z.number().int().nonnegative(),
    freq: finite.min(0).max(1),
    costIfIgnored: finite.nullable(),
    exceptions: z.array(z.object({
      prefer: z.string().min(1),
      heldRanks: z.string(),
      discardedRanks: z.string(),
      flushPenalty: z.number().int().min(0).max(5),
      straightPenalty: z.number().int().min(0).max(5),
      suitPattern: z.string().regex(/^[0-3]{0,5}\/[0-3]{0,5}$/).optional(),
    }).strict()),
  }).strict()),
}).strict();

export const serializedAnalysisSchema = z.object({
  schemaVersion: z.literal(2),
  engineVersion: z.literal(ENGINE_VERSION),
  paytableId: hash,
  key: hash,
  ...summaryShape,
  hands: z.array(handRow).length(134459),
  strategyLists: z.array(strategySchema).length(4),
}).strict();

export type SerializedAnalysis = z.infer<typeof serializedAnalysisSchema>;

export const manifestEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  paytableId: hash,
  key: hash,
  file: z.string().regex(/^[a-f0-9]{64}\.bin$/),
  sha256: hash,
  bytes: z.number().int().positive(),
  ...summaryShape,
}).strict();

export const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  engineVersion: z.literal(ENGINE_VERSION),
  compression: z.literal("gzip"),
  entries: z.array(manifestEntrySchema).length(8),
}).strict();

export type PrecomputedManifest = z.infer<typeof manifestSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

export type PrecomputedGameAnalysis = GameAnalysis & { readonly strategyLists: readonly StrategyList[] };

export function serializeAnalysis(analysis: GameAnalysis, paytableId: string, strategyLists: readonly StrategyList[]): SerializedAnalysis {
  if (analysis.engineVersion !== ENGINE_VERSION) throw new Error("Cannot serialize an outdated engine analysis.");
  const { perHand, ...summary } = analysis;
  return {
    schemaVersion: 2, ...summary, valueVector: [...summary.valueVector], rankProbs: [...summary.rankProbs],
    engineVersion: ENGINE_VERSION, paytableId, key: analysisKey(analysis.familyId, analysis.valueVector, analysis.betCoins),
    hands: [...perHand].map(([id, hand]) => [
      id, hand.weight, hand.bestMask, hand.secondMask, hand.ev, hand.secondEv, hand.bestLabel, hand.secondLabel,
    ]),
    strategyLists: [...strategyLists],
  };
}

export function deserializeAnalysis(input: unknown, expected?: ManifestEntry): PrecomputedGameAnalysis {
  const data = serializedAnalysisSchema.parse(input);
  const family = getGameFamily(data.familyId);
  if (data.valueVector.length !== family.handRanks.length ||
      data.valueVector.at(-1) !== 0 || data.rankProbs.length !== family.handRanks.length ||
      Math.abs(data.rankProbs.reduce((a, b) => a + b, 0) - 1) > 1e-9 ||
      data.key !== analysisKey(data.familyId, data.valueVector, data.betCoins)) {
    throw new Error("Precomputed analysis has inconsistent rank data or identity.");
  }
  if (expected && (data.key !== expected.key || data.paytableId !== expected.paytableId ||
      data.familyId !== expected.familyId || data.returnPct !== expected.returnPct ||
      data.betCoins !== expected.betCoins || data.variance !== expected.variance ||
      data.hitFreq !== expected.hitFreq || JSON.stringify(data.valueVector) !== JSON.stringify(expected.valueVector) ||
      JSON.stringify(data.rankProbs) !== JSON.stringify(expected.rankProbs))) {
    throw new Error("Precomputed analysis does not match the manifest.");
  }
  if (new Set(data.strategyLists.map(list => list.tier)).size !== 4 ||
      data.strategyLists.some(list => list.analysisKey !== data.key ||
        Math.abs(data.returnPct - list.returnPct - list.costVsOptimal) > 1e-8 ||
        list.tier === "Beginner" && list.lines.length > 12 ||
        list.tier === "Expert" && (list.costVsOptimal > 0.02 + 1e-10 || list.optimalDecisionFreq < 0.999) ||
        list.tier === "Perfect" && (list.costVsOptimal !== 0 || list.lines.length !== 0))) {
    throw new Error("Precomputed strategy lists are inconsistent.");
  }
  const perHand = new Map<number, GameHandResult>();
  let weightSum = 0;
  let weightedEv = 0;
  for (const [id, weight, bestMask, secondMask, ev, secondEv, bestLabel, secondLabel] of data.hands) {
    unpackHand(id);
    if (perHand.has(id) || ev < secondEv || bestMask === secondMask) throw new Error("Invalid precomputed hand row.");
    perHand.set(id, { weight, bestMask, secondMask, ev, secondEv, bestLabel, secondLabel });
    weightSum += weight;
    weightedEv += ev * weight / 2598960;
  }
  if (weightSum !== 2598960) throw new Error("Precomputed weights do not cover the deck.");
  const mean = data.rankProbs.reduce((sum, probability, rank) =>
    sum + probability * data.valueVector[rank] / data.betCoins, 0);
  const secondMoment = data.rankProbs.reduce((sum, probability, rank) =>
    sum + probability * (data.valueVector[rank] / data.betCoins) ** 2, 0);
  const hitFreq = data.rankProbs.reduce((sum, probability, rank) =>
    sum + (data.valueVector[rank] > 0 ? probability : 0), 0);
  if (Math.abs(mean * 100 - data.returnPct) > 1e-8 ||
      Math.abs(weightedEv * 100 / data.betCoins - data.returnPct) > 1e-8 ||
      Math.abs(Math.max(0, secondMoment - mean ** 2) - data.variance) > 1e-8 ||
      Math.abs(hitFreq - data.hitFreq) > 1e-9) {
    throw new Error("Precomputed summary does not match its probabilities and hand EVs.");
  }
  return {
    engineVersion: data.engineVersion, familyId: data.familyId, valueVector: data.valueVector,
    betCoins: data.betCoins, returnPct: data.returnPct, variance: data.variance,
    hitFreq: data.hitFreq, rankProbs: data.rankProbs, perHand,
    strategyLists: data.strategyLists,
  };
}
