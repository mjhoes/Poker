/*
 * The luck band: how a stretch of play could turn out, from the pay table's real distribution of final hands under
 * optimal strategy (the engine's rank probabilities). Rare big pays (a royal, straight flushes, bonus quads) are drawn
 * as counts, since they shape the tails; the many small outcomes are summed with the normal approximation, which is
 * accurate at thousands of hands. Short stretches are simulated hand by hand. Deterministic for a given seed.
 */

export type Outcome = { prob: number; pay: number };
export type RiskInput = {
  /** Probability and pay (as a multiple of the bet: 800 for a 4,000-coin royal at 5 coins) of each final hand. */
  outcomes: readonly Outcome[];
  hands: number; betCents: number;
  /** Expected return lost to mistakes, in percentage points (0 for perfect play); taken off every hand. */
  mistakePct?: number;
  trials?: number; seed?: number;
  /** For tests: force one method. */
  method?: "direct" | "mixed";
};
export type RiskBand = {
  p10Cents: number; p50Cents: number; p90Cents: number; meanCents: number; sdCents: number;
  /** Share of trials that finished ahead (net > 0), 0–1. */
  aheadShare: number; trials: number; method: "direct" | "mixed";
};

/** Outcomes from the engine's rank probabilities and value vector (coins paid per rank at `betCoins`). */
export function outcomesFrom(rankProbs: readonly number[], valueVector: readonly number[], betCoins: number): Outcome[] {
  return rankProbs.map((prob, rank) => ({ prob, pay: valueVector[rank] / betCoins })).filter(outcome => outcome.prob > 0);
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(random: () => number) {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
function poisson(lambda: number, random: () => number) {
  if (lambda > 60) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(random)));
  const limit = Math.exp(-lambda);
  let count = 0, product = random();
  while (product > limit) { count++; product *= random(); }
  return count;
}
const quantile = (sorted: Float64Array, q: number) => {
  const index = (sorted.length - 1) * q, low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};

export function simulateRisk(input: RiskInput): RiskBand {
  const total = input.outcomes.reduce((sum, outcome) => sum + outcome.prob, 0);
  if (!(total > 0) || !(input.hands >= 0) || !(input.betCents > 0)) throw new Error("Nothing to simulate.");
  const outcomes = input.outcomes.map(outcome => ({ prob: outcome.prob / total, pay: outcome.pay }));
  const hands = Math.round(input.hands);
  const shift = (input.mistakePct ?? 0) / 100;
  const trials = input.trials ?? 4000;
  const random = mulberry32(input.seed ?? 0x5eed);
  const method = input.method ?? (hands <= 2000 ? "direct" : "mixed");
  const results = new Float64Array(trials);
  const mean = outcomes.reduce((sum, outcome) => sum + outcome.prob * outcome.pay, 0);
  const variance = outcomes.reduce((sum, outcome) => sum + outcome.prob * (outcome.pay - mean) ** 2, 0);

  if (method === "direct") {
    const cdf = new Float64Array(outcomes.length);
    outcomes.reduce((sum, outcome, index) => (cdf[index] = sum + outcome.prob), 0);
    for (let trial = 0; trial < trials; trial++) {
      let paid = 0;
      for (let hand = 0; hand < hands; hand++) {
        const u = random();
        let low = 0, high = cdf.length - 1;
        while (low < high) { const mid = (low + high) >> 1; if (cdf[mid] < u) low = mid + 1; else high = mid; }
        paid += outcomes[low].pay;
      }
      results[trial] = paid - hands * (1 + shift);
    }
  } else {
    // Rare: few expected occurrences and a big pay. Their counts are drawn; everything else is summed as a normal.
    const rare = outcomes.filter(outcome => outcome.pay >= 20 && hands * outcome.prob < 50);
    const common = outcomes.filter(outcome => !rare.includes(outcome));
    const commonProb = common.reduce((sum, outcome) => sum + outcome.prob, 0);
    const commonMean = common.reduce((sum, outcome) => sum + outcome.prob * outcome.pay, 0) / commonProb;
    const commonVar = common.reduce((sum, outcome) => sum + outcome.prob * (outcome.pay - commonMean) ** 2, 0) / commonProb;
    for (let trial = 0; trial < trials; trial++) {
      let paid = 0, rareHands = 0;
      for (const outcome of rare) {
        const count = poisson(hands * outcome.prob, random);
        rareHands += count; paid += count * outcome.pay;
      }
      const rest = Math.max(0, hands - rareHands);
      paid += rest * commonMean + Math.sqrt(rest * commonVar) * normal(random);
      results[trial] = paid - hands * (1 + shift);
    }
  }
  const sorted = results.slice().sort();
  const scale = input.betCents;
  return {
    p10Cents: quantile(sorted, 0.1) * scale, p50Cents: quantile(sorted, 0.5) * scale, p90Cents: quantile(sorted, 0.9) * scale,
    meanCents: hands * (mean - 1 - shift) * scale, sdCents: Math.sqrt(hands * variance) * scale,
    aheadShare: results.reduce((count, value) => count + (value > 0 ? 1 : 0), 0) / trials, trials, method,
  };
}
