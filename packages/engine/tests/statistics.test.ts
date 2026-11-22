import { describe, expect, it } from "vitest";
import { aggregateStatistics, categoryDistribution, computeStatistics, STATS_ESTIMATE_MIN_COVERAGE } from "../src/statistics";
import { localDayBounds } from "../src/calendar";
import type { CategoryDistribution, StatsObservation } from "../src/statistics";
import type { GameAnalysis } from "../src/game-analysis";

const now = Date.UTC(2026, 10, 22, 12);
const day = 86_400_000;
const distribution: CategoryDistribution = {
  familyId: "jacks_or_better", coins: 5, optimalReturnPct: 100,
  frequencies: { COMMON: 0.9, RARE: 0.1 },
};
const observation = (label: string, evLoss: number, createdAt = now): StatsObservation => ({
  bestLabel: label, chosenLabel: evLoss ? "WRONG" : label, evLoss, createdAt,
});
describe("mistake intelligence", () => {
  it("adds a pooled-loss estimate at 99% coverage without changing the ceiling or complete-only field", () => {
    const sample = [observation("COMMON", 2, now - 14 * day), observation("COMMON", 0)];
    const report = computeStatistics(sample, { ...distribution, frequencies: { COMMON: STATS_ESTIMATE_MIN_COVERAGE, RF: 1 - STATS_ESTIMATE_MIN_COVERAGE } }, now);
    const pooledLoss = 1 / 1.5;
    expect(report.realPlayWeightedReturnPct).toBeNull();
    expect(report.realPlayWeightedEstimatePct).toBeCloseTo(100 - 100 * pooledLoss / 5);
    expect(report.imputedFrequencyShare).toBeCloseTo(0.01);
    expect(report.coveredReturnCeilingPct).toBeCloseTo(100 - 100 * 0.99 * pooledLoss / 5);
    expect(computeStatistics(sample, { ...distribution, frequencies: { COMMON: 0.9899, RF: 0.0101 } }, now).realPlayWeightedEstimatePct).toBeNull();
    expect(computeStatistics([], distribution, now).realPlayWeightedEstimatePct).toBeNull();
    const full = computeStatistics([...sample, observation("RARE", 1)], distribution, now);
    expect(full.realPlayWeightedEstimatePct).toBe(full.realPlayWeightedReturnPct);
    expect(full.imputedFrequencyShare).toBe(0);
  });
  it("buckets 8 PM New York on its local date and handles both DST day lengths", () => {
    const report = computeStatistics([observation("COMMON", 0, Date.parse("2026-11-02T01:00:00Z"))], distribution, now, { timeZone: "America/New_York" });
    expect(report.trend[0].at).toBe(Date.UTC(2026, 10, 1));
    const spring = localDayBounds("2026-03-08", "America/New_York");
    const fall = localDayBounds("2026-11-01", "America/New_York");
    expect(spring.until + 1 - spring.since).toBe(23 * 3_600_000);
    expect(fall.until + 1 - fall.since).toBe(25 * 3_600_000);
    expect(fall.since).toBe(Date.parse("2026-11-01T04:00:00Z"));
    expect(() => localDayBounds("2026-02-31", "America/New_York")).toThrow();
  });
  it("preserves raw, daily, posterior and decayed metrics after aggregation and further aging", () => {
    const sample = [
      observation("COMMON", 0.5, Date.parse("2026-11-01T05:30Z")),
      observation("COMMON", 0, Date.parse("2026-11-01T06:30Z")),
      observation("RARE", 2, Date.parse("2026-11-02T01:00Z")),
      { ...observation("COMMON", 0, Date.parse("2026-11-02T01:01Z")), isCorrection: true },
    ];
    const timeZone = "America/New_York", aggregates = aggregateStatistics(sample, timeZone);
    for (const clock of [now, now + 7 * day]) {
      const raw = computeStatistics(sample, distribution, clock, { timeZone });
      const archived = computeStatistics([], distribution, clock, { timeZone, aggregates });
      expect(archived).toMatchObject({ n: raw.n, errors: raw.errors, evLostTotal: raw.evLostTotal, excludedCorrections: 1, trend: raw.trend });
      for (const field of ["weightedN", "posteriorErrorRate", "asDrilledReturnPct", "realPlayWeightedReturnPct", "realPlayWeightedEstimatePct"] as const) expect(archived[field]).toBeCloseTo(raw[field]!, 12);
      raw.categories.forEach((row, i) => {
        const other = archived.categories[i];
        expect(other.label).toBe(row.label);
        for (const field of ["weightedN", "weightedErrors", "weightedEvLost", "errorRate", "avgEvLoss", "confidence", "weakness"] as const) expect(other[field]).toBeCloseTo(row[field], 12);
      });
    }
  });
  it("reweights over-sampled hard categories rather than confusing drill mix with real play", () => {
    const decisions = [
      ...Array.from({ length: 10 }, () => observation("COMMON", 0)),
      ...Array.from({ length: 90 }, () => observation("RARE", 0.5)),
    ];
    const report = computeStatistics(decisions, distribution, now);
    expect(report).toMatchObject({ n: 100, errors: 90, evLostTotal: 45, frequencyCoverage: 1, unseenCategories: 0 });
    expect(report.accuracyPct).toBeCloseTo(10);
    expect(report.asDrilledReturnPct).toBeCloseTo(91);
    expect(report.realPlayWeightedReturnPct).toBeCloseTo(99);
    expect(report.evLostPer1000).toBe(450);
    const rare = report.categories.find(row => row.label === "RARE")!;
    expect(rare.errorRate).toBeCloseTo(91 / 92);
    expect(rare.avgEvLoss).toBe(0.5);
    expect(rare.confidence).toBeCloseTo(90 / 110);
    expect(rare.weakness).toBeCloseTo((91 / 92) * 0.5 * 0.1 * (90 / 110));
  });
  it("applies an exact 14-day half-life to Beta counts, mistake cost and confidence", () => {
    const report = computeStatistics([
      observation("RARE", 2, now - 14 * day), observation("RARE", 0), observation("COMMON", 0),
    ], distribution, now);
    const rare = report.categories.find(row => row.label === "RARE")!;
    expect(rare).toMatchObject({ n: 2, errors: 1, evLostTotal: 2, weightedN: 1.5, weightedErrors: 0.5, weightedEvLost: 1 });
    expect(rare.errorRate).toBeCloseTo(1.5 / 3.5);
    expect(rare.avgEvLoss).toBe(2);
    expect(rare.confidence).toBeCloseTo(1.5 / 21.5);
    expect(report.asDrilledReturnPct).toBe(92);
    expect(report.realPlayWeightedReturnPct).toBeCloseTo(100 - (100 * (0.1 * (1 / 1.5))) / 5);
    expect(report.accuracyPct).toBeCloseTo(200 / 3);
    expect(report.trend).toHaveLength(2);
    expect(report.trend[0]).toMatchObject({ n: 1, errors: 1, accuracyPct: 0, asDrilledReturnPct: 60 });
    expect(report.trend[1]).toMatchObject({ n: 2, errors: 0, accuracyPct: 100, asDrilledReturnPct: 100 });
    expect(report.trend[1].at - report.trend[0].at).toBe(14 * day); // No invented zero-observation days.
  });
  it("retains the primary mistake but excludes assisted corrections", () => {
    const report = computeStatistics([
      observation("COMMON", 1),
      { ...observation("COMMON", 0), isCorrection: true },
      observation("RARE", 0),
    ], distribution, now);
    expect(report).toMatchObject({ n: 2, errors: 1, evLostTotal: 1, excludedCorrections: 1 });
    expect(report.confusion.find(row => row.bestLabel === "COMMON")).toMatchObject({ n: 1, errors: 1, chosenLabel: "WRONG" });
  });
  it("reports incomplete coverage instead of inventing costs for unseen categories", () => {
    const report = computeStatistics([observation("RARE", 0.5)], distribution, now);
    expect(report.realPlayWeightedReturnPct).toBeNull();
    expect(report.coveredReturnCeilingPct).toBeCloseTo(99);
    expect(report.frequencyCoverage).toBe(0.1);
    expect(report.unseenCategories).toBe(1);
    const unseen = report.categories.find(row => row.label === "COMMON")!;
    expect(unseen).toMatchObject({ n: 0, confidence: 0, errorRate: 0.5, weakness: 0 });
  });
  it("provides honest empty states and rejects invalid data", () => {
    const report = computeStatistics([], distribution, now);
    expect(report).toMatchObject({ n: 0, accuracyPct: null, asDrilledReturnPct: null, realPlayWeightedReturnPct: null, coveredReturnCeilingPct: null, evLostPer1000: null });
    expect(report.trend).toEqual([]);
    expect(() => computeStatistics([observation("UNKNOWN", 0)], distribution, now)).toThrow(/absent/);
    expect(() => computeStatistics([observation("RARE", -1)], distribution, now)).toThrow();
    expect(() => computeStatistics([observation("RARE", NaN)], distribution, now)).toThrow();
    expect(() => computeStatistics([observation("RARE", 0, now + 1)], distribution, now)).toThrow();
    expect(() => computeStatistics([], { ...distribution, frequencies: { RARE: 0.1 } }, now)).toThrow(/sum/);
  });
  it("accepts zero-loss equivalent holds across labels and applies the engine tie tolerance", () => {
    const report = computeStatistics([{ ...observation("COMMON", 1e-10), chosenLabel: "EQUIVALENT" }], distribution, now);
    expect(report).toMatchObject({ n: 1, errors: 0, evLostTotal: 0, accuracyPct: 100 });
    expect(report.confusion[0]).toMatchObject({ bestLabel: "COMMON", chosenLabel: "EQUIVALENT", errors: 0 });
  });
  it("normalizes EV loss with the actual bet, including short-coin royal behavior", () => {
    const input = [observation("COMMON", 0.1), observation("RARE", 0)];
    const one = computeStatistics(input, { ...distribution, coins: 1, optimalReturnPct: 98 }, now);
    const five = computeStatistics(input.map(row => ({ ...row, evLoss: row.evLoss * 5 })), { ...distribution, coins: 5, optimalReturnPct: 98 }, now);
    expect(one.asDrilledReturnPct).toBeCloseTo(93);
    expect(one.realPlayWeightedReturnPct).toBeCloseTo(89);
    expect(five.realPlayWeightedReturnPct).toBeCloseTo(one.realPlayWeightedReturnPct!);
    expect(five.asDrilledReturnPct).toBeCloseTo(one.asDrilledReturnPct!);
  });
  it("uses suit multiplicities, not canonical-hand counts, for real-play frequencies", () => {
    const game = {
      familyId: "jacks_or_better", betCoins: 5, returnPct: 99.5,
      perHand: new Map([[1, { bestLabel: "COMMON", weight: 24 }], [2, { bestLabel: "RARE", weight: 4 }]]),
    } as unknown as GameAnalysis;
    const result = categoryDistribution(game);
    expect(result.frequencies.COMMON).toBeCloseTo(24 / 28);
    expect(result.frequencies.RARE).toBeCloseTo(4 / 28);
  });
  it("down-weights tiny samples and deterministically ranks equal-cost categories", () => {
    const a = computeStatistics([observation("RARE", 1)], distribution, now).categories[0];
    const b = computeStatistics(Array.from({ length: 30 }, () => observation("RARE", 1)), distribution, now).categories[0];
    expect(a.confidence).toBeLessThan(b.confidence);
    expect(a.weakness).toBeLessThan(b.weakness);
    expect(computeStatistics([], distribution, now).categories.map(row => row.label)).toEqual(["COMMON", "RARE"]);
  });
});
