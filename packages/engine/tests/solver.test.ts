import { describe, expect, it } from "vitest";
import { analyzeHand, choose, GAME_FAMILIES, parseHand } from "../src";
import type { GameFamilyId, HandAnalysis } from "../src";
import { referenceRank } from "./reference";

const JOB = [4000, 250, 125, 45, 30, 20, 15, 10, 5, 0];
const DW = [4000, 1000, 125, 75, 45, 25, 15, 10, 10, 5, 0];

function result(analysis: HandAnalysis, mask: number) {
  return analysis.results.find(hold => hold.mask === mask)!;
}

describe("exact 32-hold enumeration", () => {
  it("returns 32 unique sorted holds with exact denominators and normalized distributions", () => {
    const cards = parseHand("Ah Kh Qh Jh Ts");
    const analysis = analyzeHand(cards, JOB);
    expect(analysis.results).toHaveLength(32);
    expect(new Set(analysis.results.map(hold => hold.mask)).size).toBe(32);
    expect(analysis.hand).toEqual(cards);
    expect(analysis.hand).not.toBe(cards);
    let total = 0;
    for (let i = 0; i < 32; i++) {
      const hold = analysis.results[i];
      const held = hold.mask.toString(2).replace(/0/g, "").length;
      expect(hold.drawCount).toBe(choose(47, 5 - held));
      expect(hold.rankDist.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(hold.rankCounts.reduce((sum, value) => sum + value, 0)).toBe(hold.drawCount);
      expect(hold.rankCounts.every(Number.isInteger)).toBe(true);
      expect(hold.ev).toBeCloseTo(hold.rankDist.reduce((sum, value, rank) => sum + value * JOB[rank], 0), 10);
      if (i) expect(analysis.results[i - 1].ev).toBeGreaterThanOrEqual(hold.ev);
      total += hold.drawCount;
    }
    expect(total).toBe(2598960);
    expect(analysis.best.mask).toBe(15); // Break the made straight for four to a royal.
    expect(result(analysis, 31).ev).toBe(20);
    expect(result(analysis, 15).rankCounts[0]).toBe(1);
    // Only two non-heart tens remain: the third (Ts) was discarded.
    expect(result(analysis, 15).rankCounts).toEqual([1, 0, 0, 0, 8, 2, 0, 0, 12, 24]);
    expect(result(analysis, 15).ev).toBeCloseTo((4000 + 8 * 30 + 2 * 20 + 12 * 5) / 47, 12);
    expect(analysis.gapToSecond).toBe(analysis.best.ev - analysis.results[1].ev);
  });

  it("keeps made royals and four deuces", () => {
    const royal = analyzeHand(parseHand("As Ks Qs Js Ts"), JOB);
    expect(royal.best.mask).toBe(31);
    expect(royal.best.ev).toBe(4000);
    const deuces = analyzeHand(parseHand("2c 2d 2h 2s As"), DW, "deuces_wild");
    expect(deuces.best.mask).toBe(15);
    expect(deuces.best.ev).toBe(1000);
  }, 30_000);

  it("uses payout values, not hard-coded strategy", () => {
    const hand = parseHand("Ah Kh Qh Jh Ts");
    const ordinary = analyzeHand(hand, JOB);
    const noRoyal = analyzeHand(hand, JOB.map((value, rank) => rank === 0 ? 0 : value));
    expect(ordinary.best.mask).toBe(15);
    expect(noRoyal.best.mask).not.toBe(15);
    const scaled = analyzeHand(hand, JOB.map(value => value * 2));
    expect(scaled.best.mask).toBe(ordinary.best.mask);
    for (const hold of ordinary.results) expect(result(scaled, hold.mask).ev).toBeCloseTo(hold.ev * 2, 12);
  });

  it("preserves input mask positions and is invariant under suit permutation", () => {
    const hand = parseHand("Ts Ah Kh Qh Jh");
    const before = [...hand];
    const analysis = analyzeHand(hand, JOB);
    expect(analysis.best.mask).toBe(30);
    expect(hand).toEqual(before);
    const permuted = hand.map(card => (card >> 2) * 4 + ((card % 4 + 1) % 4));
    const other = analyzeHand(permuted, JOB);
    for (const hold of analysis.results) {
      expect(result(other, hold.mask).rankCounts).toEqual(hold.rankCounts);
    }
  });

  it.each(Object.keys(GAME_FAMILIES) as GameFamilyId[])(
    "%s matches separately enumerated one/two-card draws with discards excluded",
    familyId => {
      const hand = familyId === "deuces_wild"
        ? parseHand("2c As Ad Ah 3c") : parseHand("As Ad Ah Ac 3c");
      const family = GAME_FAMILIES[familyId];
      const values = family.handRanks.map((rank, i) => rank === "NOTHING" ? 0 : (i + 1) * 1.25);
      const analysis = analyzeHand(hand, values, familyId);
      const deck = Array.from({ length: 52 }, (_, i) => i).filter(card => !hand.includes(card));
      for (const mask of [15, 7, 23, 31]) {
        const held = hand.filter((_, i) => mask & (1 << i));
        const rankCounts = Array(family.handRanks.length).fill(0);
        const draw = (start: number): void => {
          if (held.length === 5) {
            rankCounts[family.handRanks.indexOf(referenceRank(held, familyId))]++;
            return;
          }
          for (let i = start; i <= deck.length - (5 - held.length); i++) {
            held.push(deck[i]);
            draw(i + 1);
            held.pop();
          }
        };
        draw(0);
        expect(result(analysis, mask).rankCounts).toEqual(rankCounts);
      }
      // The 3c is in the deal and cannot be drawn after holding four aces.
      if (familyId === "double_double_bonus") {
        expect(result(analysis, 15).rankCounts[family.handRanks.indexOf("FOUR_ACES_W_234")]).toBe(11);
      }
    }, 30_000,
  );

  it("has deterministic ties and does not mutate the vector", () => {
    const values = Object.freeze(JOB.map(() => 0));
    const analysis = analyzeHand(parseHand("As Ks Qs Js Ts"), values);
    expect(analysis.results.map(hold => hold.mask)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(analysis.gapToSecond).toBe(0);
  });

  it("validates input and explicit family/vector alignment", () => {
    const hand = parseHand("As Ks Qs Js Ts");
    expect(() => analyzeHand([0, 0, 1, 2, 3], JOB)).toThrow();
    expect(() => analyzeHand(hand, [])).toThrow();
    expect(() => analyzeHand(hand, JOB, "deuces_wild")).toThrow();
    expect(() => analyzeHand(hand, JOB.map(() => NaN))).toThrow();
    expect(() => analyzeHand(hand, JOB.map(() => Infinity))).toThrow();
    expect(() => analyzeHand(hand, JOB.map(() => -1))).toThrow();
    expect(() => analyzeHand(hand, JOB.map(() => 1))).toThrow(/NOTHING/);
    expect(() => analyzeHand(hand, new Array(10))).toThrow();
  });
});
