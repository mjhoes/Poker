import { afterAll, describe, expect, it } from "vitest";
import { analyzeHandFast, clearSubsetCache, dealRound, getGameFamily, gradeDecision, parseHand, resolveRound } from "../src";
import type { GameFamilyId } from "../src";

const vector = [4000, 250, 125, 45, 30, 20, 15, 10, 5, 0];
afterAll(() => clearSubsetCache());
describe("round dealing and payouts", () => {
  it("creates distinct deals and independently shuffled decks excluding all five originals", () => {
    let seed = 17;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
    const round = dealRound(10, random);
    expect(new Set(round.hand).size).toBe(5);
    expect(round.drawDecks).toHaveLength(10);
    for (const deck of round.drawDecks) {
      expect(new Set(deck).size).toBe(47);
      expect(deck.some(card => round.hand.includes(card))).toBe(false);
    }
    expect(round.drawDecks[0]).not.toEqual(round.drawDecks[1]);
  });
  it("keeps the chosen positions and never returns an original discard for every hold", () => {
    const round = dealRound(3, () => 0.2);
    for (let mask = 0; mask < 32; mask++) {
      const outcome = resolveRound(round.hand, mask, round.drawDecks, "jacks_or_better", vector);
      for (const line of outcome.lines) {
        expect(new Set(line.hand).size).toBe(5);
        line.hand.forEach((card, index) => {
          if (mask & (1 << index)) expect(card).toBe(round.hand[index]);
          else expect(round.hand).not.toContain(card);
        });
      }
      expect(resolveRound(round.hand, mask, round.drawDecks, "jacks_or_better", vector)).toEqual(outcome);
    }
  });
  it.each(["jacks_or_better", "bonus_poker", "bonus_poker_deluxe", "double_bonus", "double_double_bonus", "deuces_wild"] as GameFamilyId[])("uses %s's engine evaluator and the supplied vector", family => {
    const hand = parseHand("Ac Kc Qc Jc Tc");
    const decks = Array.from({ length: 3 }, () => Array.from({ length: 52 }, (_, i) => i).filter(card => !hand.includes(card)));
    const values = getGameFamily(family).handRanks.map((_, i) => i === 0 ? 4000 : 0);
    const result = resolveRound(hand, 31, decks, family, values);
    expect(result.totalPayoutCoins).toBe(12000);
    expect(result.lines.every(line => line.rank === (family === "deuces_wild" ? "NATURAL_ROYAL" : "ROYAL_FLUSH"))).toBe(true);
  });
  it("rejects invalid RNG, masks, decks, and line counts", () => {
    expect(() => dealRound(0)).toThrow();
    expect(() => dealRound(11)).toThrow();
    expect(() => dealRound(1, () => 1)).toThrow();
    const round = dealRound(1);
    expect(() => resolveRound(round.hand, 32, round.drawDecks, "jacks_or_better", vector)).toThrow();
    const bad = [...round.drawDecks[0]]; bad[0] = round.hand[0];
    expect(() => resolveRound(round.hand, 0, [bad], "jacks_or_better", vector)).toThrow();
  });
});
describe("decision grading", () => {
  it("reports exact configured-bet EV loss without changing the user's choice", () => {
    const analysis = analyzeHandFast(parseHand("Ah Kh Qh Jh Ts"), vector);
    const grade = gradeDecision(analysis, 31, 3);
    expect(grade.chosenMask).toBe(31);
    expect(grade.bestMask).toBe(15);
    expect(grade.chosenEv).toBe(20);
    expect(grade.evLoss).toBe(analysis.best.ev - 20);
    expect(grade.totalEvLoss).toBe(3 * grade.evLoss);
    expect(grade.correct).toBe(false);
    expect(gradeDecision(analysis, 15).correct).toBe(true);
  });
  it("accepts equivalent optimal holds instead of requiring one mask", () => {
    const analysis = analyzeHandFast(parseHand("2c 3d 7h 9s Ac"), Array(10).fill(0));
    expect(gradeDecision(analysis, 31)).toMatchObject({ correct: true, evLoss: 0 });
  });
});
