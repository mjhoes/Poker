import type { GameAnalysis } from "./game-analysis";
import type { GameFamilyId } from "./types";

export const STATS_HALF_LIFE_DAYS = 14;
export const STATS_CONFIDENCE_PRIOR = 20;
const DAY = 86_400_000;
export interface StatsObservation {
  bestLabel: string; chosenLabel: string; evLoss: number; createdAt: number;
  isCorrection?: boolean;
}
export interface CategoryDistribution {
  familyId: GameFamilyId; coins: number; optimalReturnPct: number;
  frequencies: Readonly<Record<string, number>>;
}
export interface CategoryStats {
  label: string; n: number; errors: number; evLostTotal: number;
  weightedN: number; weightedErrors: number; weightedEvLost: number;
  /** Beta(1,1) posterior mean using fractional, decayed observations. */
  errorRate: number; avgEvLoss: number; frequency: number; confidence: number;
  /** Coins lost per real deal, with posterior and confidence adjustments. */
  weakness: number;
}
export interface ConfusionStats extends Omit<CategoryStats, "label" | "frequency" | "confidence" | "weakness"> {
  bestLabel: string; chosenLabel: string;
}
export interface TrendStats {
  at: number; n: number; errors: number; accuracyPct: number;
  evLostPer1000: number; asDrilledReturnPct: number;
}
export interface StatsReport {
  familyId: GameFamilyId; coins: number; now: number; halfLifeDays: number; confidencePrior: number;
  optimalReturnPct: number; n: number; errors: number; evLostTotal: number;
  weightedN: number; accuracyPct: number | null; posteriorErrorRate: number;
  evLostPer1000: number | null; asDrilledReturnPct: number | null;
  realPlayWeightedReturnPct: number | null;
  /** Incomplete-coverage ceiling, NOT a statistical confidence bound or complete forecast. */
  coveredReturnCeilingPct: number | null;
  frequencyCoverage: number; unseenCategories: number; excludedCorrections: number;
  excludedIncompatible: number;
  categories: CategoryStats[]; confusion: ConfusionStats[]; trend: TrendStats[];
}
interface Accumulator { n: number; errors: number; evLostTotal: number; weightedN: number; weightedErrors: number; weightedEvLost: number }
const empty = (): Accumulator => ({ n: 0, errors: 0, evLostTotal: 0, weightedN: 0, weightedErrors: 0, weightedEvLost: 0 });
function update(row: Accumulator, loss: number, weight: number) {
  row.n++; row.errors += loss > 1e-9 ? 1 : 0; row.evLostTotal += loss;
  row.weightedN += weight; row.weightedErrors += loss > 1e-9 ? weight : 0; row.weightedEvLost += weight * loss;
}
const posterior = (row: Accumulator) => (1 + row.weightedErrors) / (2 + row.weightedN);
const averageMistake = (row: Accumulator) => row.weightedErrors > 0 ? row.weightedEvLost / row.weightedErrors : 0;

/** Optimal labels form a canonical partition; raw canonical counts are multiplicity-weighted. */
export function categoryDistribution(analysis: GameAnalysis): CategoryDistribution {
  const weights = new Map<string, number>();
  let total = 0;
  for (const row of analysis.perHand.values()) {
    if (!Number.isFinite(row.weight) || row.weight <= 0 || !row.bestLabel) throw new Error("Invalid game-analysis category weights.");
    weights.set(row.bestLabel, (weights.get(row.bestLabel) ?? 0) + row.weight); total += row.weight;
  }
  if (!total) throw new Error("A complete game analysis is required for real-play frequencies.");
  return { familyId: analysis.familyId, coins: analysis.betCoins, optimalReturnPct: analysis.returnPct,
    frequencies: Object.fromEntries([...weights].map(([label, weight]) => [label, weight / total])) };
}

/** All EV/statistical calculations stay pure and deterministic; callers supply the clock. */
export function computeStatistics(observations: readonly StatsObservation[], distribution: CategoryDistribution, now: number): StatsReport {
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(distribution.coins) || distribution.coins <= 0 ||
    !Number.isFinite(distribution.optimalReturnPct)) throw new Error("Invalid statistics clock or bet baseline.");
  const frequencies = Object.entries(distribution.frequencies);
  if (!frequencies.length || frequencies.some(([label, value]) => !label || !Number.isFinite(value) || value <= 0) ||
    Math.abs(frequencies.reduce((sum, [, value]) => sum + value, 0) - 1) > 1e-8) throw new Error("Real-play frequencies must sum to one.");
  const categories = new Map<string, Accumulator>(frequencies.map(([label]) => [label, empty()]));
  const pairs = new Map<string, { bestLabel: string; chosenLabel: string; data: Accumulator }>();
  const days = new Map<number, Accumulator>();
  const total = empty(); let excludedCorrections = 0;
  for (const decision of observations) {
    if (decision.isCorrection) { excludedCorrections++; continue; }
    if (!Number.isFinite(decision.evLoss) || decision.evLoss < 0 || !Number.isFinite(decision.createdAt) ||
      decision.createdAt < 0 || decision.createdAt > now || !decision.chosenLabel) throw new Error("Invalid decision loss or timestamp.");
    const category = categories.get(decision.bestLabel);
    if (!category) throw new Error(`Decision category is absent from the exact game analysis: ${decision.bestLabel}`);
    const weight = 2 ** (-(now - decision.createdAt) / (STATS_HALF_LIFE_DAYS * DAY));
    // Floating-point ties are correct and must not contribute a numerical pseudo-loss.
    const loss = decision.evLoss > 1e-9 ? decision.evLoss : 0;
    update(total, loss, weight); update(category, loss, weight);
    const key = JSON.stringify([decision.bestLabel, decision.chosenLabel]);
    const pair = pairs.get(key) ?? { bestLabel: decision.bestLabel, chosenLabel: decision.chosenLabel, data: empty() };
    update(pair.data, loss, weight); pairs.set(key, pair);
    const at = Math.floor(decision.createdAt / DAY) * DAY;
    const day = days.get(at) ?? empty(); update(day, loss, 1); days.set(at, day);
  }
  let coverage = 0, realLoss = 0, unseenCategories = 0;
  const rows = frequencies.map(([label, frequency]): CategoryStats => {
    const row = categories.get(label)!;
    const confidence = row.weightedN / (row.weightedN + STATS_CONFIDENCE_PRIOR);
    if (row.weightedN > 0) { coverage += frequency; realLoss += frequency * row.weightedEvLost / row.weightedN; }
    else unseenCategories++;
    return { label, ...row, errorRate: posterior(row), avgEvLoss: averageMistake(row), frequency, confidence,
      weakness: posterior(row) * averageMistake(row) * frequency * confidence };
  }).sort((a, b) => b.weakness - a.weakness || b.evLostTotal - a.evLostTotal || a.label.localeCompare(b.label));
  const coveredReturnCeilingPct = total.weightedN > 0 ? distribution.optimalReturnPct - 100 * realLoss / distribution.coins : null;
  return {
    familyId: distribution.familyId, coins: distribution.coins, now, halfLifeDays: STATS_HALF_LIFE_DAYS,
    confidencePrior: STATS_CONFIDENCE_PRIOR, optimalReturnPct: distribution.optimalReturnPct,
    n: total.n, errors: total.errors, evLostTotal: total.evLostTotal, weightedN: total.weightedN,
    accuracyPct: total.n ? 100 * (1 - total.errors / total.n) : null, posteriorErrorRate: posterior(total),
    evLostPer1000: total.n ? 1000 * total.evLostTotal / total.n : null,
    asDrilledReturnPct: total.weightedN > 0 ? distribution.optimalReturnPct - 100 * total.weightedEvLost / total.weightedN / distribution.coins : null,
    realPlayWeightedReturnPct: unseenCategories === 0 ? coveredReturnCeilingPct : null,
    coveredReturnCeilingPct, frequencyCoverage: Math.min(1, coverage), unseenCategories, excludedCorrections,
    excludedIncompatible: 0,
    categories: rows,
    confusion: [...pairs.values()].map(({ bestLabel, chosenLabel, data }) => ({ bestLabel, chosenLabel, ...data, errorRate: posterior(data), avgEvLoss: averageMistake(data) }))
      .sort((a, b) => b.evLostTotal - a.evLostTotal || b.n - a.n || a.bestLabel.localeCompare(b.bestLabel) || a.chosenLabel.localeCompare(b.chosenLabel)),
    trend: [...days].sort((a, b) => a[0] - b[0]).map(([at, row]) => ({ at, n: row.n, errors: row.errors,
      accuracyPct: 100 * (1 - row.errors / row.n), evLostPer1000: 1000 * row.evLostTotal / row.n,
      asDrilledReturnPct: distribution.optimalReturnPct - 100 * row.evLostTotal / row.n / distribution.coins })),
  };
}
