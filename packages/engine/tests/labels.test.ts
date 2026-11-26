import { describe, expect, it } from "vitest";
import { GAME_FAMILIES, describeHold, describeLabel, labelHold, parseHand } from "../src";
import type { GameFamilyId } from "../src";
import { seededHands } from "./reference";

describe("deterministic hold vocabulary", () => {
  it.each([
    ["Ah Kh Qh Jh Ts", 15, "4RF|pen:straight"],
    ["Ah Kh Qh Jh Th", 31, "RF"],
    ["2h 3h 6h 9h 2c", 15, "4FL"],
    ["2h 3h 6h 9h 2c", 17, "LP"],
    ["Jh Jc 3h 6s 9d", 3, "HP"],
    ["9h Th Jh Qh 2c", 15, "4SF_open"],
    ["Ah 2c 3d 4s 9h", 15, "4ST_inside_h1"],
    ["Kh Qs Jc 4d 2h", 7, "KQJ_unsuited"],
    ["Qh Jh 3s 6c 8d", 3, "2RF_QJ|pen:straight"],
    ["Ah 2c 5d 8s 9h", 1, "1H_A|pen:flush,straight"],
    ["Ah Kh Qh 7h 2c", 7, "3RF_h3|pen:flush"],
    ["Ah Kh Qh Jc 2s", 7, "3RF_h3|pen:straight"],
    ["Ah 2c 5d 8s 9h", 0, "DRAW5"],
  ] as const)("%s mask %i → %s", (hand, mask, expected) => {
    expect(labelHold(parseHand(hand), mask)).toBe(expected);
  });

  it.each([
    ["4h 5h 6h Kc Ad", "3SF_t1"],
    ["7h 8h 9h Kc Ad", "3SF_t1"],
    ["2h 3h 4h Kc Qd", "3SF_t2"],
    ["Ah 2h 3h Kc Qd", "3SF_t2"],
    ["Ah 2h 5h Kc Qd", "3SF_t2"],
    ["Jh Th 9h Kc Ad", "3SF_t1"],
    ["9h 7h 5h Kc Ad", "3SF_t3"],
    ["Jh 9h 7h Kc Ad", "3SF_t2"],
  ])("uses the standard three-card straight-flush convention for %s", (hand, label) => {
    expect(describeHold(parseHand(hand), 7).base).toBe(label);
  });

  it.each([
    ["4RF|pen:straight", "jacks_or_better", "4 to a Royal Flush (straight penalty)"],
    ["D2_ONLY", "deuces_wild", "Two deuces only"],
    ["KQJ_unsuited", "jacks_or_better", "Unsuited KQJ"],
    ["3SF_t1", "jacks_or_better", "3 to a Straight Flush (type 1)"],
    ["3SF_t2|pen:none", "jacks_or_better", "3 to a Straight Flush (type 2; no penalty cards)"],
    ["4K_A_w234", "double_double_bonus", "Four Aces with a 2, 3, or 4 kicker"],
    ["RF / SF", "jacks_or_better", "First available: Royal Flush; Straight Flush"],
    ["D0_RF", "deuces_wild", "Natural Royal Flush (no deuces held)"],
    ["HP", "double_double_bonus", "Pair of Jacks, Queens, or Kings"],
    ["HP_A", "bonus_poker", "Pair of Aces"],
    ["D0_LP", "deuces_wild", "Pair of 3s through Tens (no deuces held)"],
    // A count of one is singular, whichever kind of draw it describes.
    ["D1_4SF_g1_w1_d1", "deuces_wild", "4 to a Straight Flush (1 gap; 1 straight pattern; low-end draw; one deuce held)"],
    ["D0_4RF_w1_d0", "deuces_wild", "4 to a Royal Flush (1 straight pattern; no low-end pattern; no deuces held)"],
    ["D1_3RF_h0_w1_d0", "deuces_wild", "3 to a Royal Flush (0 high cards; 1 straight pattern; no low-end pattern; one deuce held)"],
    ["4ST_g0_h1_w1", "jacks_or_better", "4 to a Straight (no flush) (0 gaps; 1 high card; 1 straight pattern)"],
    ["D0_4RF_w2_d0", "deuces_wild", "4 to a Royal Flush (2 straight patterns; no low-end pattern; no deuces held)"],
  ] as const)("describes %s without exposing its label syntax", (label, family, expected) => {
    expect(describeLabel(label, family)).toBe(expected);
  });

  it("describes Reference refinements and rejects unknown labels or modifiers", () => {
    expect(describeLabel("3RF_h3|pen:flush|r:AKQ|p:1,0", "jacks_or_better"))
      .toBe("3 to a Royal Flush (3 high cards; held ranks AKQ; 1 flush penalty card)");
    expect(() => describeLabel("MAGIC", "jacks_or_better")).toThrow(/Unknown/);
    expect(() => describeLabel("RF|secret:1", "jacks_or_better")).toThrow(/modifier/);
    expect(() => describeLabel("D2_ONLY", "jacks_or_better")).toThrow(/Deuces/);
  });

  it.each([
    ["As Ad Ah Ac 2c", 31, "double_double_bonus", "4K_A_w234"],
    ["As Ad Ah Ac 5c", 31, "double_double_bonus", "4K_A"],
    ["2s 2d 2h 2c As", 31, "double_double_bonus", "4K_234_wA234"],
    ["2s 2d 2h 2c As", 15, "deuces_wild", "D4_4D"],
    ["2c As Kd 7h 9c", 1, "deuces_wild", "D1_ONLY"],
    ["Ah Kh Qh 2c 3s", 7, "deuces_wild", "D0_3RF_w1_d0"],
    ["Ac Ad 2c 2d 3c", 3, "double_double_bonus", "HP_A"],
    ["Ac Ad 2c 2d 3c", 15, "double_double_bonus", "2P_A"],
    ["Ac Ad Ah 2c 2d", 7, "double_double_bonus", "3K_A"],
    ["Ac Ad Ah 2c 2d", 15, "double_double_bonus", "3K_A_w234"],
    ["3c 3d 3h Ac 7d", 15, "double_double_bonus", "3K_234_wA234"],
    ["4c 4d 4h Ac 7d", 7, "bonus_poker", "3K_234"],
    ["5c 5d 5h Ac 7d", 7, "double_bonus", "3K_5K"],
    ["Ac Ad 2c 2d 3c", 3, "bonus_poker_deluxe", "HP"],
    ["Ac Ad Ah 2c 2d", 7, "jacks_or_better", "3K"],
    ["6c 8c Kd Qh 2d", 3, "jacks_or_better", "2SF_g1_h0_w3"],
    ["4c 5d 6h Kc As", 7, "jacks_or_better", "3ST_g0_h0_w3"],
    ["3c 7c Jc Qd Ah", 7, "jacks_or_better", "3FL_h1"],
  ] as const)("labels variant-aware holds in %s", (hand, mask, family, expected) => {
    expect(labelHold(parseHand(hand), mask, family)).toBe(expected);
  });

  it.each(Object.keys(GAME_FAMILIES) as GameFamilyId[])(
    "%s: labels all holds on 300 hands, independent of suits and card order",
    family => {
      for (const hand of seededHands(300)) {
        const permuted = hand.map(card => (card & ~3) + ((card & 3) + 1) % 4).reverse();
        for (let mask = 0; mask < 32; mask++) {
          const reversed = [0, 1, 2, 3, 4].reduce((out, i) => out | ((mask & (1 << i)) ? 1 << (4 - i) : 0), 0);
          const original = describeHold(hand, mask, family);
          expect(original.label.length).toBeGreaterThan(0);
          expect(describeHold(permuted, reversed, family)).toEqual(original);
        }
      }
    }, 30_000,
  );

  it("validates masks, duplicate cards, unsupported families, and penalty counts", () => {
    expect(() => labelHold([0, 1, 2, 3, 4], 32)).toThrow();
    expect(() => labelHold([0, 1, 2, 3, 3], 0)).toThrow();
    expect(() => labelHold([0, 1, 2, 3, 4], 0, "joker" as GameFamilyId)).toThrow();
    const pattern = describeHold(parseHand("Ah Kh Qh 7h Jh"), 7);
    expect(pattern.flushPenalty).toBe(2);
    expect(pattern.straightPenalty).toBe(1);
  });
});
