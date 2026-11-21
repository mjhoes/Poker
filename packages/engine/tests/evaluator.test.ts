import { beforeAll, describe, expect, it } from "vitest";
import { evaluateHand, GAME_FAMILIES, initializeEvaluator, parseHand } from "../src";
import type { GameFamilyId, HandRankId } from "../src";
import { lookupTable } from "../src/evaluator";
import { referenceRank, seededHands } from "./reference";

const families = Object.keys(GAME_FAMILIES) as GameFamilyId[];

beforeAll(() => {
  for (const family of families) initializeEvaluator(family);
}, 60_000);

describe("non-wild made hands", () => {
  const hands: [string, HandRankId][] = [
    ["As Ks Qs Js Ts", "ROYAL_FLUSH"],
    ["Ah 2h 3h 4h 5h", "STRAIGHT_FLUSH"],
    ["9c Tc Jc Qc Kc", "STRAIGHT_FLUSH"],
    ["As Ad Ah Ac Ks", "FOUR_KIND"],
    ["9c 9d 9h 3s 3c", "FULL_HOUSE"],
    ["2c 4c 7c Jc Kc", "FLUSH"],
    ["As 2d 3h 4c 5s", "STRAIGHT"],
    ["Ts Jd Qh Kc As", "STRAIGHT"],
    ["9c 9d 9h 3s 4c", "THREE_KIND"],
    ["9c 9d 3h 3s 4c", "TWO_PAIR"],
    ["Jc Jd 3h 5s 7c", "JACKS_OR_BETTER"],
    ["Tc Td 3h 5s 7c", "NOTHING"],
    ["Qc Kd Ah 2s 3c", "NOTHING"],
  ];
  it.each(hands)("%s → %s", (hand, rank) => {
    expect(evaluateHand(parseHand(hand))).toBe(rank);
    expect(evaluateHand(parseHand(hand).slice().reverse(), "bonus_poker_deluxe")).toBe(rank);
  });

  it.each([
    ["As Ad Ah Ac 2c", "FOUR_ACES_W_234", "FOUR_ACES"],
    ["As Ad Ah Ac 4c", "FOUR_ACES_W_234", "FOUR_ACES"],
    ["As Ad Ah Ac 5c", "FOUR_ACES", "FOUR_ACES"],
    ["2s 2d 2h 2c As", "FOUR_234_W_A234", "FOUR_234"],
    ["3s 3d 3h 3c 4s", "FOUR_234_W_A234", "FOUR_234"],
    ["4s 4d 4h 4c 5s", "FOUR_234", "FOUR_234"],
    ["5s 5d 5h 5c As", "FOUR_5K", "FOUR_5K"],
    ["Ks Kd Kh Kc 2s", "FOUR_5K", "FOUR_5K"],
  ] as const)("classifies kicker-sensitive quads: %s", (hand, ddb, bonus) => {
    expect(evaluateHand(parseHand(hand), "double_double_bonus")).toBe(ddb);
    for (const family of ["bonus_poker", "double_bonus"] as const) {
      expect(evaluateHand(parseHand(hand), family)).toBe(bonus);
    }
  });
});

describe("Deuces Wild", () => {
  it.each([
    ["As Ks Qs Js Ts", "NATURAL_ROYAL"],
    ["2c 2d 2h 2s As", "FOUR_DEUCES"],
    ["2c Ks Qs Js Ts", "WILD_ROYAL"],
    ["2c 2d Qs Js Ts", "WILD_ROYAL"],
    ["2c 2d 2h Ks Qs", "WILD_ROYAL"],
    ["2c As Ad Ah Ac", "FIVE_KIND"],
    ["2c 2d As Ah Ac", "FIVE_KIND"],
    ["2c 2d 2h As Ac", "FIVE_KIND"],
    ["2c 3h 4h 5h 6h", "STRAIGHT_FLUSH"],
    ["2c Ah 3h 4h 5h", "STRAIGHT_FLUSH"],
    ["2c As Ad Ah 7c", "FOUR_KIND"],
    ["2c As Ad Kh Kc", "FULL_HOUSE"],
    ["2c 3h 5h 8h Kh", "FLUSH"],
    ["2c 3h 4s 5h 6d", "STRAIGHT"],
    ["2c Ah 3s 4h 5d", "STRAIGHT"],
    ["2c 3h 3s 5h 7d", "THREE_KIND"],
    ["2c 2h 5s 8h Kd", "THREE_KIND"],
    ["3c 3h 5s 5h Kd", "NOTHING"],
    ["Ac Ah 5s 8h Kd", "NOTHING"],
    ["2c Qh Ks Ah 3d", "NOTHING"],
    ["2c Ah Ad 3h 4h", "THREE_KIND"],
  ] as const)("%s → %s", (hand, rank) => {
    expect(evaluateHand(parseHand(hand), "deuces_wild")).toBe(rank);
  });
});

describe("independent evaluator checks", () => {
  it.each(families)("%s matches a group-based reference on seeded hands", family => {
    for (const cards of seededHands(1000)) {
      expect(evaluateHand(cards, family), `${family}: ${cards}`).toBe(referenceRank(cards, family));
    }
  });

  it("matches rank-assignment reference for all ranks with one, two, or three deuces", () => {
    for (let wilds = 1; wilds <= 3; wilds++) {
      for (let offset = 0; offset < 12; offset++) {
        const cards = Array.from({ length: wilds }, (_, i) => i);
        for (let i = wilds; i < 5; i++) cards.push((((offset + i) % 12) + 1) * 4 + (i % 4));
        expect(evaluateHand(cards, "deuces_wild"), `${cards}`).toBe(referenceRank(cards, "deuces_wild"));
        // Repeat with suited naturals: the oracle must test flush/royal precedence.
        const suited = cards.map((card, i) => i < wilds ? card : card - card % 4 + 3);
        expect(evaluateHand(suited, "deuces_wild"), `${suited}`).toBe(referenceRank(suited, "deuces_wild"));
      }
    }
  });

  it("matches exhaustive, known 52-card poker category counts", () => {
    const counts = Array(GAME_FAMILIES.jacks_or_better.handRanks.length).fill(0);
    for (const rank of lookupTable("jacks_or_better")) counts[rank]++;
    expect(counts).toEqual([
      4, 36, 624, 3744, 5108, 10200, 54912, 123552, 337920, 2062860,
    ]);
    expect(counts.reduce((sum: number, value: number) => sum + value, 0)).toBe(2598960);
  });

  it("shares tables only when hand-rank semantics match", () => {
    expect(lookupTable("jacks_or_better")).toBe(lookupTable("bonus_poker_deluxe"));
    expect(lookupTable("bonus_poker")).toBe(lookupTable("double_bonus"));
    expect(lookupTable("bonus_poker")).not.toBe(lookupTable("double_double_bonus"));
  });

  it("rejects invalid cards, duplicates, and unsupported families", () => {
    expect(() => evaluateHand([0, 1, 2, 3, 52])).toThrow();
    expect(() => evaluateHand([0, 1, 2, 3, 3])).toThrow();
    expect(() => evaluateHand([0, 1, 2, 3, 4], "joker" as GameFamilyId)).toThrow(/Unsupported/);
  });
});
