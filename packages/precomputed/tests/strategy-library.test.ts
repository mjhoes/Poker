import { expect, it } from "vitest";
import {
  analyzeGame, clearEvaluatorCache, clearSubsetCache, clearTrainingCache, describeLabel,
  generateStrategyList, registerTrainingAnalysis, standardVariant, STRATEGY_TIERS,
  strategyExceptionCount, strategyMeetsTarget,
} from "@perfect-draw/engine";
import { analysisKey, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";

it("snapshots actual replayed gaps for every library table and describes every chart/reference label", () => {
  const reports = [];
  let misses = 0;
  for (const table of PAY_TABLE_LIBRARY) {
    const values = standardVariant.valueVector(table, 5, {});
    const analysis = analyzeGame(table.familyId, values, undefined, { betCoins: 5 });
    const key = analysisKey(table.familyId, values, 5);
    registerTrainingAnalysis(key, analysis);
    const lists = STRATEGY_TIERS.map(tier => generateStrategyList(key, tier));
    const labels = new Set<string>();
    for (const list of lists) {
      expect(list.meetsTarget).toBe(strategyMeetsTarget(list));
      if (!list.meetsTarget) misses++;
      expect(list.returnPct).toBeLessThanOrEqual(analysis.returnPct + 1e-9);
      expect(list.forMemorization).toBe(list.tier !== "Reference" && list.tier !== "Perfect");
      if (list.tier === "Expert") {
        expect(list.lines.length).toBeLessThanOrEqual(60);
        expect(strategyExceptionCount(list)).toBeLessThanOrEqual(15);
      }
      if (list.tier === "Beginner") {
        expect(list.lines.length).toBeLessThanOrEqual(15);
        expect(list.refinement).toBe(0);
      }
      for (const line of list.lines) {
        if (list.tier === "Expert" && line.label.includes("|pen:")) expect(line.costIfIgnored).toBeGreaterThan(0);
        labels.add(line.label);
        for (const alternative of line.alternatives ?? []) labels.add(alternative);
        for (const exception of line.exceptions) labels.add(exception.prefer);
      }
    }
    for (const label of labels) {
      const description = describeLabel(label, table.familyId);
      expect(description.length).toBeGreaterThan(4);
      expect(description).not.toMatch(/[|_]|(?:^|\s)(?:RF|SF|4K|FH|FL|ST|HP|LP|DRAW5)(?:$|\s)/);
    }
    reports.push({
      table: table.slug, optimalReturnPct: Number(analysis.returnPct.toFixed(8)),
      describedLabels: labels.size,
      tiers: lists.map(list => ({
        tier: list.tier, returnPct: Number(list.returnPct.toFixed(8)),
        gapPercentagePoints: Number(list.costVsOptimal.toFixed(8)), meetsTarget: list.meetsTarget,
        lines: list.lines.length, exceptions: strategyExceptionCount(list),
      })),
    });
    clearTrainingCache(key); clearSubsetCache(); clearEvaluatorCache();
  }
  // Target misses must be reportable results, not generation-time exceptions.
  expect(misses).toBeGreaterThan(0);
  expect(reports).toMatchSnapshot();
}, 300_000);
