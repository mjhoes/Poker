import { expect, it } from "vitest";
import {
  analyzeGame, analyzeHandFast, clearEvaluatorCache, clearSubsetCache, clearTrainingCache, describeLabel,
  formatStrategyChart, generateStrategyList, getCanonicalHands, isChartLabel, parseHand,
  registerTrainingAnalysis, selectStrategyHold, standardVariant, STRATEGY_TIERS,
  strategyExceptionCount, strategyMeetsTarget, strategyTarget,
} from "@perfect-draw/engine";
import { analysisKey, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";

it("snapshots actual replayed gaps for every library table and describes every chart/reference label", () => {
  const reports = [];
  for (const table of PAY_TABLE_LIBRARY) {
    const values = standardVariant.valueVector(table, 5, {});
    const analysis = analyzeGame(table.familyId, values, undefined, { betCoins: 5 });
    const key = analysisKey(table.familyId, values, 5);
    const context = registerTrainingAnalysis(key, analysis);
    const lists = STRATEGY_TIERS.map(tier => generateStrategyList(key, tier));
    const labels = new Set<string>();
    for (const list of lists) {
      expect(list.meetsTarget).toBe(strategyMeetsTarget(list));
      expect(list.returnPct).toBeLessThanOrEqual(analysis.returnPct + 1e-9);
      expect(list.forMemorization).toBe(list.tier !== "Reference" && list.tier !== "Perfect");
      if (list.tier === "Expert") {
        expect(list.lines.length).toBeLessThanOrEqual(strategyTarget(list.tier, table.familyId).maxLines);
        expect(strategyExceptionCount(list)).toBeLessThanOrEqual(15);
      }
      if (list.tier === "Beginner") {
        expect(list.lines.length).toBeLessThanOrEqual(strategyTarget(list.tier, table.familyId).maxLines);
        expect(list.refinement).toBe(0);
      }
      if (list.tier === "Beginner" || list.tier === "Expert") {
        expect(list.meetsTarget, `${table.slug} ${list.tier}: ${list.costVsOptimal} pp`).toBe(true);
        expect(list.costVsOptimal).toBeLessThanOrEqual(strategyTarget(list.tier, table.familyId).gap);
        // Independent exhaustive first-rule replay; EV is read only AFTER choosing a hold.
        const data = context.getData();
        const priorities = new Map(list.lines.flatMap(line => line.alternatives ?? [line.label]).map((name, rank) => [name, rank]));
        const ranks = data.names[list.refinement].map(name => Math.min(priorities.get(name) ?? Infinity,
          list.refinement === 2 ? priorities.get(name.split("|")[0]) ?? Infinity : Infinity));
        let total = 0;
        for (const [h, canonical] of getCanonicalHands().entries()) {
          let chosen = 0, rank = Infinity, preference = -Infinity;
          for (let mask = 0; mask < 32; mask++) {
            const index = h * 32 + mask, candidate = ranks[data.labels[list.refinement][index]];
            if (candidate < rank || candidate === rank && data.preferences[index] > preference) {
              chosen = mask; rank = candidate; preference = data.preferences[index];
            }
          }
          total += data.evs[h * 32 + chosen] * canonical.weight / 2598960;
        }
        expect(total * 100 / analysis.betCoins).toBeCloseTo(list.returnPct, 9);
      }
      if (table.familyId === "deuces_wild" && list.tier !== "Perfect") {
        expect(list.sections?.map(section => section.deucesHeld)).toEqual([4, 3, 2, 1, 0]);
        for (const section of list.sections!) {
          expect(list.lines.slice(section.startRank, section.endRank).every(line => line.label.startsWith(`D${section.deucesHeld}_`))).toBe(true);
        }
        if (list.forMemorization) {
          const printed = formatStrategyChart(list);
          expect(printed.indexOf("4 deuces held")).toBeLessThan(printed.indexOf("3 deuces held"));
          expect(printed.indexOf("1 deuce held")).toBeLessThan(printed.indexOf("0 deuces held"));
        } else expect(() => formatStrategyChart(list)).toThrow(/not a memorization chart/);
      }
      for (const line of list.lines) {
        expect(isChartLabel(line.label)).toBe(true);
        if (list.tier === "Expert" && line.label.includes("|pen:")) expect(line.costIfIgnored).toBeGreaterThan(0);
        labels.add(line.label);
        for (const alternative of line.alternatives ?? []) labels.add(alternative);
        for (const exception of line.exceptions) labels.add(exception.prefer);
      }
    }
    const examples: [string, number][] = table.familyId === "double_double_bonus"
      ? [["Ac Ad 2c 2d 3c", 3], ["Ac Ad Ah 2c 2d", 7]]
      : table.slug === "deuces-wild-nsud" ? [["3c 4c 5d 8c 9d", 0]]
      : table.slug === "deuces-wild-full-pay" ? [["2c 3c 4c 7d 8d", 25]] : [];
    for (const [cards, mask] of examples) {
      const hand = analyzeHandFast(parseHand(cards), values, table.familyId);
      for (const list of lists.filter(list => list.tier === "Beginner" || list.tier === "Expert")) {
        expect(selectStrategyHold(hand, list), `${table.slug} ${list.tier}: ${cards}`).toBe(mask);
      }
    }
    for (let sample = 0; sample < 30; sample++) {
      const cards = getCanonicalHands()[(sample * 4919) % getCanonicalHands().length].hand;
      const hand = analyzeHandFast(cards, values, table.familyId);
      const poisoned = { ...hand, best: hand.results.at(-1)!,
        results: [...hand.results].reverse().map(hold => ({ ...hold, ev: 1000 - 10 * hold.mask })) };
      for (const list of lists.filter(list => list.tier !== "Perfect")) {
        expect(selectStrategyHold(poisoned, list)).toBe(selectStrategyHold(hand, list));
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
        ...(list.sections ? { sections: list.sections.map(section => ({
          deucesHeld: section.deucesHeld, lines: section.endRank - section.startRank,
        })) } : {}),
      })),
    });
    clearTrainingCache(key); clearSubsetCache(); clearEvaluatorCache();
  }
  expect(reports).toMatchSnapshot();
}, 300_000);
