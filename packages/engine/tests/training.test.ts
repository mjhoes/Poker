import { beforeAll, describe, expect, it } from "vitest";
import {
  analyzeGame, analyzeHandFast, canonicalizeHand, clearTrainingCache, evaluateRule, generateHand,
  generateStrategyList, getCanonicalHands, labelHold, parseHand, registerTrainingAnalysis,
  selectStrategyHold, validateRuleAST,
  MEMORIZABLE_STRATEGY_TIERS, STRATEGY_TIERS, strategyExceptionCount, strategyMeetsTarget,
} from "../src";
import type { GameAnalysis, RuleAST, StrategyList } from "../src";
import { seededHands } from "./reference";
import { getTrainingContext } from "../src/training";

const key = "9-6-job-strategy-snapshot";
const values = [4000, 250, 125, 45, 30, 20, 15, 10, 5, 0];
let game: GameAnalysis;
let lists: StrategyList[];
beforeAll(() => {
  game = analyzeGame("jacks_or_better", values, undefined, { betCoins: 5 });
  registerTrainingAnalysis(key, game);
  lists = STRATEGY_TIERS.map(tier => generateStrategyList(key, tier));
}, 120_000);

describe("engine-derived strategy tiers", () => {
  it("retains the old detailed strategy as an internal Reference, not a memorization chart", () => {
    const expert = lists[3];
    expect(expert.costVsOptimal).toBeLessThanOrEqual(0.02);
    expect(expert.optimalDecisionFreq).toBeGreaterThanOrEqual(0.999);
    expect(expert.returnPct + expert.costVsOptimal).toBeCloseTo(game.returnPct, 10);
    expect(expert.lines.reduce((sum, line) => sum + line.freq, 0)).toBeCloseTo(1, 10);
    expect(expert.lines.reduce((sum, line) => sum + line.exceptions.length, 0)).toBeGreaterThan(0);
    expect(expert.forMemorization).toBe(false);
    expect(MEMORIZABLE_STRATEGY_TIERS).not.toContain("Reference");
  });

  it("keeps Expert memorizable and adds only cost-reducing penalty refinements", () => {
    const expert = lists[2];
    expect(expert.costVsOptimal).toBeLessThanOrEqual(0.03);
    expect(expert.lines.length).toBeLessThanOrEqual(60);
    expect(strategyExceptionCount(expert)).toBeLessThanOrEqual(15);
    expect(expert.meetsTarget).toBe(true);
    expect(expert.forMemorization).toBe(true);
    expect(expert.lines.every(line => !line.exceptions.length && !/[|](?:r|p|d):/.test(line.label))).toBe(true);
    for (const line of expert.lines.filter(line => line.label.includes("|pen:"))) expect(line.costIfIgnored).toBeGreaterThan(0);
  });

  it("saves the actual ordered list and explicit contextual refinements for review", () => {
    expect(lists.map(list => ({
      tier: list.tier, returnPct: Number(list.returnPct.toFixed(8)),
      costVsOptimal: Number(list.costVsOptimal.toFixed(8)),
      optimalDecisionFreq: Number(list.optimalDecisionFreq.toFixed(8)),
      meetsTarget: list.meetsTarget, forMemorization: list.forMemorization,
      lines: list.lines.map(line => ({
        ...line, freq: Number(line.freq.toFixed(8)),
        costIfIgnored: line.costIfIgnored === null ? null : Number(line.costIfIgnored.toFixed(8)),
      })),
    }))).toMatchSnapshot();
  });

  it("greedily builds Beginner from ordered level-0 rules within 15 lines and 0.15 pp", () => {
    expect(lists[0].lines.length).toBeLessThanOrEqual(15);
    expect(lists[0].refinement).toBe(0);
    expect(lists[0].costVsOptimal).toBeLessThanOrEqual(0.15);
    expect(lists[0].costVsOptimal).toBeGreaterThan(0);
    expect(lists[0].meetsTarget).toBe(true);
    expect(lists[0].lines.every(line => !/[|]/.test(line.label))).toBe(true);
    expect(lists[1].costVsOptimal).toBeLessThan(lists[0].costVsOptimal);
    expect(lists[1].lines.every(line => !line.label.includes("|pen:"))).toBe(true);
    expect(lists[4].returnPct).toBe(game.returnPct);
    expect(lists[4].costVsOptimal).toBe(0);
    expect(lists[4].lines).toEqual([]);
  });

  it("uses labels and exceptions rather than silently falling back to the optimal hold", () => {
    let beginnerErrors = 0;
    // Include a rare, low-card type-3 SF draw as the Beginner chart improves;
    // a small random sample alone may contain no remaining chart mistakes.
    for (const cards of [...seededHands(300), parseHand("5c 7c 9c 2d 3h")]) {
      const hand = analyzeHandFast(cards, values);
      for (const list of lists) {
        const mask = selectStrategyHold(hand, list);
        const selected = hand.results.find(hold => hold.mask === mask)!;
        expect(selected.ev).toBeLessThanOrEqual(hand.best.ev);
        if (list.tier === "Perfect") expect(mask).toBe(hand.best.mask);
        if (list.tier === "Beginner" && hand.best.ev > selected.ev + 1e-10) beginnerErrors++;
      }
    }
    expect(beginnerErrors).toBeGreaterThan(0);
    expect(() => selectStrategyHold(analyzeHandFast(parseHand("As Ks Qs Js Ts"), values.map(value => value * 2)), lists[2])).toThrow(/payout/);
    expect(selectStrategyHold(analyzeHandFast(parseHand("As Ks Qs Js Ts"), values), { ...lists[0], lines: [] })).toBe(0);
  }, 60_000);

  it("resolves remaining Double Bonus conflicts using explicit suit relationships", () => {
    const dbValues = [800, 50, 160, 80, 50, 10, 7, 5, 3, 1, 1, 0].map(value => value * 5);
    const db = analyzeGame("double_bonus", dbValues, undefined, { betCoins: 5 });
    const dbKey = "double-bonus-suit-refinements";
    registerTrainingAnalysis(dbKey, db);
    try {
      const strategy = generateStrategyList(dbKey, "Reference");
      expect(strategy.optimalDecisionFreq).toBeGreaterThanOrEqual(0.999);
      expect(strategy.costVsOptimal).toBeLessThanOrEqual(0.02);
      const refinements = strategy.lines.flatMap(line => line.exceptions).filter(rule => rule.suitPattern);
      expect(refinements.length).toBeGreaterThan(0);
      for (const rule of refinements.slice(0, 30)) {
        const [heldSuits, discardedSuits] = rule.suitPattern!.split("/");
        const held = [...rule.heldRanks].reverse().map((rank, i) => rank + "cdhs"[Number(heldSuits[i])]);
        const discarded = [...rule.discardedRanks].reverse().map((rank, i) => rank + "cdhs"[Number(discardedSuits[i])]);
        const cards = parseHand([...held, ...discarded].join(" "));
        const analysis = analyzeHandFast(cards, dbValues, "double_bonus");
        const selected = selectStrategyHold(analysis, strategy);
        expect(analysis.results.find(hold => hold.mask === selected)!.ev).toBeCloseTo(analysis.best.ev, 10);
      }
    } finally { clearTrainingCache(dbKey); }
  }, 120_000);

  it("measures both bounded charts by independent exhaustive policy replay, including grouped subrule order", () => {
    const data = getTrainingContext(key).getData(), hands = getCanonicalHands();
    const independentlyReplay = (list: StrategyList): number => {
      const priority = new Map(list.lines.flatMap(line => line.alternatives ?? [line.label]).map((name, rank) => [name, rank]));
      const ranks = data.names[list.refinement].map(name => {
        const exact = priority.get(name) ?? Infinity;
        return list.refinement === 2 ? Math.min(exact, priority.get(name.split("|")[0]) ?? Infinity) : exact;
      });
      let total = 0;
      for (let h = 0; h < hands.length; h++) {
        let selectedRank = Infinity, selectedEv = -Infinity, selectedPreference = -Infinity;
        for (let mask = 0; mask < 32; mask++) {
          const index = h * 32 + mask, rank = ranks[data.labels[list.refinement][index]], ev = data.evs[index];
          const preference = data.preferences[index];
          if (rank < selectedRank || rank === selectedRank && preference > selectedPreference) {
            selectedRank = rank; selectedEv = ev; selectedPreference = preference;
          }
        }
        total += selectedEv * hands[h].weight / 2598960;
      }
      return total * 100 / game.betCoins;
    };
    for (const list of [lists[0], lists[2]]) {
      expect(independentlyReplay(list)).toBeCloseTo(list.returnPct, 10);
      expect(list.returnPct).toBeLessThan(game.returnPct);
      const index = list.tier === "Beginner" ? 0 : list.lines.findIndex(line => line.label.includes("|pen:"));
      const line = list.lines[index];
      const omitted = { ...list, lines: list.lines.filter((_, i) => i !== index) };
      expect(list.returnPct - independentlyReplay(omitted)).toBeCloseTo(line.costIfIgnored!, 9);
      expect(list.meetsTarget).toBe(strategyMeetsTarget(list));
    }
    // Poisoning the supplied perfect-play answer cannot alter a chart's hold.
    for (const cards of seededHands(50)) {
      const analysis = analyzeHandFast(cards, values);
      for (const list of lists.filter(item => item.tier !== "Perfect")) {
        const poisoned = { ...analysis, best: analysis.results.at(-1)!,
          results: [...analysis.results].reverse().map(hold => ({ ...hold, ev: 10_000 - 100 * hold.mask })) };
        expect(selectStrategyHold(poisoned, list)).toBe(selectStrategyHold(analysis, list));
      }
    }
  }, 60_000);

  it("uses higher ranks for equal-pattern pairs and ignores unnamed chart rules", () => {
    const analysis = analyzeHandFast(parseHand("2c 2d 5c 5d 9s"), values);
    const fallback = { label: "DRAW5", rank: 1, exceptions: [], freq: 0, costIfIgnored: null };
    const pair = { ...fallback, label: "LP", rank: 0 };
    const chart = { ...lists[0], lines: [pair, fallback] };
    expect(selectStrategyHold(analysis, chart)).toBe(12);
    const misleading = { ...analysis, results: analysis.results.map(hold => ({ ...hold, ev: hold.mask === 3 ? 1e9 : 0 })) };
    expect(selectStrategyHold(misleading, chart)).toBe(12);
    expect(selectStrategyHold(analysis, { ...chart, lines: [{ ...pair, label: "OTHER_2" }, fallback] })).toBe(0);
  });

  it("uses a visible suit-pattern tie even when it is not the highest-EV hold", () => {
    const cards = parseHand("Jc Jd 7c 8d 2h");
    const analysis = analyzeHandFast(cards, values);
    const line = { label: "1H_J", rank: 0, exceptions: [], freq: 0, costIfIgnored: null };
    const chart = { ...lists[0], lines: [line, { ...line, label: "DRAW5", rank: 1 }] };
    expect(analysis.results.find(hold => hold.mask === 1)!.ev)
      .toBeGreaterThan(analysis.results.find(hold => hold.mask === 2)!.ev);
    expect(selectStrategyHold(analysis, chart)).toBe(2);
    for (let shift = 0; shift < 4; shift++) {
      const renamed = cards.map(card => (card & ~3) + ((card & 3) + shift) % 4).reverse();
      expect(selectStrategyHold(analyzeHandFast(renamed, values), chart)).toBe(8);
    }
  });

  it("returns measured target misses for custom tables instead of throwing", () => {
    const customKey = "high-stakes-custom-target-miss";
    const custom = analyzeGame("jacks_or_better", values.map(value => value * 100), undefined, { betCoins: 5 });
    registerTrainingAnalysis(customKey, custom);
    try {
      const chart = generateStrategyList(customKey, "Beginner");
      expect(chart.costVsOptimal).toBeGreaterThan(0.15);
      expect(chart.meetsTarget).toBe(false);
      expect(chart.returnPct + chart.costVsOptimal).toBeCloseTo(custom.returnPct, 8);
    } finally { clearTrainingCache(customKey); }
  }, 120_000);
});

describe("JSON heuristic validation", () => {
  const bad: RuleAST = { kind: "prefer", prefer: { label: "LP" }, over: { label: "4FL" } };
  it("scores a bad local rule against all canonical hands and returns real counterexamples", () => {
    const result = evaluateRule(bad, key);
    expect(result.costVsOptimal).toBeGreaterThan(0);
    expect(result.handsAffected).toBeGreaterThan(result.canonicalHandsAffected);
    expect(result.counterexamples.length).toBeGreaterThan(0);
    expect(result.returnPct).toBeCloseTo(game.returnPct - result.costVsOptimal, 10);
    for (const example of result.counterexamples) {
      const hand = analyzeHandFast(example.hand, values);
      expect(labelHold(example.hand, example.chosenMask).split("|")[0]).toBe("LP");
      expect(example.evLoss).toBeCloseTo(hand.best.ev - hand.results.find(hold => hold.mask === example.chosenMask)!.ev, 10);
    }
  }, 30_000);

  it("supports exceptions without fabricating numbers or changing unrelated higher plays", () => {
    const before = evaluateRule(bad, key);
    const after = evaluateRule({ ...bad, unless: { kind: "rank", rank: "2", in: "held" } }, key);
    expect(after.handsAffected).toBeLessThan(before.handsAffected);
    expect(after.costVsOptimal).toBeLessThanOrEqual(before.costVsOptimal);
    const tautology: RuleAST = {
      ...bad, unless: { kind: "or", conditions: [
        { kind: "penalty", penalty: "flush" },
        { kind: "not", condition: { kind: "penalty", penalty: "flush" } },
      ] },
    };
    expect(evaluateRule(tautology, key).handsAffected).toBe(0);
    expect(evaluateRule({ kind: "prefer", prefer: { label: "4FL" }, over: { label: "LP" } }, key).costVsOptimal).toBeCloseTo(0, 10);
  }, 30_000);

  it("rejects unknown syntax/categories, excessive nesting, cycles, and unknown analyses", () => {
    expect(() => validateRuleAST({ ...bad, eval: "() => 5" })).toThrow();
    expect(() => evaluateRule({ ...bad, prefer: { label: "MAGIC" } }, key)).toThrow(/unknown/);
    expect(() => evaluateRule(bad, "missing")).toThrow(/registered/);
    expect(() => validateRuleAST({ ...bad, unless: { kind: "penalty", penalty: "flush", min: -1 } })).toThrow();
    const cycle: { kind: "not"; condition?: unknown } = { kind: "not" };
    cycle.condition = cycle;
    expect(() => validateRuleAST({ ...bad, unless: cycle })).toThrow(/complex/);
  });
});

describe("targeted drill generation", () => {
  it("remaps holds correctly after random suit permutations and card-order shuffles", () => {
    let seed = 42;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const displays = new Set<string>();
    const row = [...game.perHand.values()].find(item => item.bestLabel.split("|")[0] !== item.secondLabel.split("|")[0])!;
    const targetPairs = [{ correct: row.bestLabel.split("|")[0], confusedWith: row.secondLabel.split("|")[0] }];
    let recent: number[] = [];
    for (let i = 0; i < 60; i++) {
      const drill = generateHand({ analysisKey: key, targetPairs, excludeRecent: recent, random });
      const analysis = analyzeHandFast(drill.hand, values);
      expect(canonicalizeHand(drill.hand).id).toBe(drill.canonicalHandId);
      expect(analysis.results.find(hold => hold.mask === drill.bestMask)!.ev).toBe(drill.ev);
      expect(analysis.results.find(hold => hold.mask === drill.secondMask)!.ev).toBe(drill.secondEv);
      expect(analysis.best.ev).toBe(drill.ev);
      expect(recent).not.toContain(drill.canonicalHandId);
      expect(drill.bestLabel.split("|")[0]).toBe(targetPairs[0].correct);
      displays.add(drill.hand.join(","));
      recent = [drill.canonicalHandId];
    }
    expect(displays.size).toBeGreaterThan(1);
  }, 30_000);

  it("weights random play by real-deal multiplicity, not uniform canonical classes", () => {
    const hands = getCanonicalHands();
    const ticket = (hands[0].weight + 0.1) / 2598960;
    const actual = generateHand({ analysisKey: key, random: () => ticket });
    expect(actual.canonicalHandId).toBe(hands[1].id);
    expect(generateHand({ analysisKey: key, sampling: "canonical", random: () => ticket }).canonicalHandId).toBe(hands[0].id);
    const close = generateHand({ analysisKey: key, closeCallMaxGap: 0, random: () => 0 });
    expect(close.ev).toBe(close.secondEv);
  });

  it("fails explicitly rather than ignoring unsatisfiable filters", () => {
    expect(() => generateHand({ analysisKey: key, targetPairs: [{ correct: "MAGIC", confusedWith: "LP" }] })).toThrow(/No drill/);
    expect(() => generateHand({ analysisKey: key, excludeRecent: [...game.perHand.keys()] })).toThrow(/No drill/);
    expect(() => generateHand({ analysisKey: key, closeCallMaxGap: -1 })).toThrow();
    expect(() => generateHand({ analysisKey: key, random: () => 1 })).toThrow();
    expect(() => generateHand({ analysisKey: key, random: () => NaN })).toThrow();
  });
});
