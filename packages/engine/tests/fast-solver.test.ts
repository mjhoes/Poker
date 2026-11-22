import { describe, expect, it } from "vitest";
import { analyzeHand, analyzeHandFast, canonicalizeHand, GAME_FAMILIES, getCanonicalHands, parseHand, restoreHoldMask, unpackHand } from "../src";
import type { GameFamilyId } from "../src";
import { seededHands } from "./reference";

const values = [4000, 250, 125, 45, 30, 20, 15, 10, 5, 0];

describe("subset inclusion–exclusion", () => {
  it("exactly matches naive counts and EVs, including original input mask positions", () => {
    for (const hand of [parseHand("Ts Ah Kh Qh Jh"), ...seededHands(10)]) {
      expect(analyzeHandFast(hand, values)).toEqual(analyzeHand(hand, values));
    }
  }, 60_000);

  it.each(Object.keys(GAME_FAMILIES) as GameFamilyId[])(
    "%s: fast solver matches naive on 1,000 seeded, unsorted deals",
    familyId => {
      const vector = GAME_FAMILIES[familyId].handRanks.map((rank, i) =>
        rank === "NOTHING" ? 0 : (20 - i) * 1.25);
      for (const hand of seededHands(1000)) {
        expect(analyzeHandFast(hand, vector, familyId)).toEqual(analyzeHand(hand, vector, familyId));
      }
    }, 180_000,
  );

  it("keeps holds and rank counts unchanged when the value vector is doubled", () => {
    const hand = parseHand("Ah Kh Qh Jh Ts");
    const before = analyzeHandFast(hand, values);
    const after = analyzeHandFast(hand, values.map(value => value * 2));
    expect(after.results.map(hold => hold.mask)).toEqual(before.results.map(hold => hold.mask));
    for (let i = 0; i < 32; i++) {
      expect(after.results[i].ev).toBe(before.results[i].ev * 2);
      expect(after.results[i].rankCounts).toEqual(before.results[i].rankCounts);
    }
  });

  it("rejects invalid hands and vectors rather than returning partial results", () => {
    expect(() => analyzeHandFast([0, 1, 2, 3, 3], values)).toThrow();
    expect(() => analyzeHandFast([0, 1, 2, 3, 52], values)).toThrow();
    expect(() => analyzeHandFast([0, 1, 2, 3, 4], [1])).toThrow();
    expect(() => analyzeHandFast([0, 1, 2, 3, 4], values.map(() => Infinity))).toThrow();
  });
});

describe("suit-isomorphic deals", () => {
  it("enumerates exactly 134,459 classes covering 2,598,960 deals", () => {
    const hands = getCanonicalHands();
    expect(hands.length).toBe(134459);
    expect(hands.reduce((sum, hand) => sum + hand.weight, 0)).toBe(2598960);
    expect(new Set(hands.map(hand => hand.id)).size).toBe(134459);
    for (let i = 0; i < hands.length; i += 997) expect(unpackHand(hands[i].id)).toEqual(hands[i].hand);
  }, 60_000);

  it("remaps canonical hold masks to unsorted originals", () => {
    for (const cards of seededHands(20)) {
      const canonical = canonicalizeHand(cards);
      const original = analyzeHandFast(cards, values);
      const normalized = analyzeHandFast(canonical.hand, values);
      expect(normalized.best.ev).toBe(original.best.ev);
      const restored = restoreHoldMask(normalized.best.mask, canonical.canonicalToOriginal);
      expect(original.results.find(hold => hold.mask === restored)!.ev).toBe(original.best.ev);
    }
  }, 60_000);

  it("assigns appropriate weights to symmetric and asymmetric suit patterns", () => {
    expect(canonicalizeHand(parseHand("Ah Kh Qh Jh Th")).weight).toBe(4);
    expect(canonicalizeHand(parseHand("Ac Ad Ah As Kc")).weight).toBe(4);
    expect(canonicalizeHand(parseHand("Ac Kd Qh Js Tc")).weight).toBe(24);
    const hand = parseHand("Ac Ad Kh Qs Jd");
    const canonical = canonicalizeHand(hand);
    const permutation = [2, 0, 3, 1];
    expect(canonicalizeHand(hand.map(card => (card & ~3) + permutation[card & 3])).id).toBe(canonical.id);
    expect(() => restoreHoldMask(32, [0, 1, 2, 3, 4])).toThrow();
    expect(() => unpackHand(0)).toThrow();
  });
});
