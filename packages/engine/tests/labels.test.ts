import { describe, expect, it } from "vitest";
import { GAME_FAMILIES, describeHold, labelHold, parseHand } from "../src";
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
    ["Ah 2c 5d 8s 9h", 1, "1H_A"],
    ["Ah Kh Qh 7h 2c", 7, "3RF_h3|pen:flush"],
    ["Ah Kh Qh Jc 2s", 7, "3RF_h3|pen:straight"],
    ["Ah 2c 5d 8s 9h", 0, "DRAW5"],
  ] as const)("%s mask %i → %s", (hand, mask, expected) => {
    expect(labelHold(parseHand(hand), mask)).toBe(expected);
  });

  it.each([
    ["As Ad Ah Ac 2c", 31, "double_double_bonus", "4K_A_w234"],
    ["As Ad Ah Ac 5c", 31, "double_double_bonus", "4K_A"],
    ["2s 2d 2h 2c As", 31, "double_double_bonus", "4K_234_wA234"],
    ["2s 2d 2h 2c As", 15, "deuces_wild", "D4_4D"],
    ["2c As Kd 7h 9c", 1, "deuces_wild", "D1_ONLY"],
    ["Ah Kh Qh 2c 3s", 7, "deuces_wild", "D0_3RF_h3"],
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
