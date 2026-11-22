import { beforeAll, describe, expect, it } from "vitest";
import { analyzeGame, analyzeHandFast, canonicalizeHand, clearEvaluatorCache, clearSubsetCache, standardVariant } from "@perfect-draw/engine";
import type { GameAnalysis } from "@perfect-draw/engine";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";

const analyses = new Map<string, GameAnalysis>();

beforeAll(() => {
  for (const table of PAY_TABLE_LIBRARY) {
    analyses.set(table.slug, analyzeGame(table.familyId, standardVariant.valueVector(table, 5, {}), undefined, { betCoins: 5 }));
    clearSubsetCache();
    clearEvaluatorCache();
  }
}, 120_000);

describe("computed returns, not stored reference substitutions", () => {
  it.each(PAY_TABLE_LIBRARY)("$name matches both sources to the required tolerance", table => {
    const analysis = analyses.get(table.slug)!;
    expect(Math.abs(analysis.returnPct - table.referenceReturnPct)).toBeLessThanOrEqual(0.005);
    expect(analysis.perHand.size).toBe(134459);
    expect(analysis.rankProbs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(analysis.hitFreq).toBeGreaterThan(0);
    expect(analysis.hitFreq).toBeLessThan(1);
    expect(analysis.variance).toBeGreaterThan(0);
    const expected = analysis.rankProbs.reduce((sum, probability, rank) =>
      sum + probability * analysis.valueVector[rank] / analysis.betCoins, 0);
    expect(analysis.returnPct).toBeCloseTo(expected * 100, 9);
  });

  it("the per-hand index agrees with direct fast analysis", () => {
    const table = PAY_TABLE_LIBRARY[0];
    const game = analyses.get(table.slug)!;
    const canonical = canonicalizeHand([47, 50, 42, 38, 34]);
    const direct = analyzeHandFast(canonical.hand, game.valueVector, game.familyId);
    expect(game.perHand.get(canonical.id)).toEqual({
      weight: canonical.weight, bestMask: direct.best.mask, secondMask: direct.results[1].mask,
      ev: direct.best.ev, secondEv: direct.results[1].ev,
    });
  });

  it("value scaling preserves all best holds and doubles EV", () => {
    const table = PAY_TABLE_LIBRARY[0];
    const before = analyses.get(table.slug)!;
    const after = analyzeGame(table.familyId, before.valueVector.map(value => value * 2), undefined, { betCoins: 10 });
    expect(after.returnPct).toBe(before.returnPct);
    expect(after.variance).toBe(before.variance);
    for (const [id, row] of before.perHand) {
      expect(after.perHand.get(id)!.bestMask).toBe(row.bestMask);
      expect(after.perHand.get(id)!.ev).toBe(row.ev * 2);
    }
  }, 60_000);
});
