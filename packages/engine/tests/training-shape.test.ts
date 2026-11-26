import { describe, expect, it } from "vitest";
import { getCanonicalHands } from "../src/canonical";
import { describeHoldUnchecked } from "../src/labels";
import { patternOf, trainingShape } from "../src/training";
import type { HeldShape } from "../src/training";
import type { GameFamilyId } from "../src/types";

/*
 * Training data describes each held set once and counts the penalties per deal (`trainingShape`). It must give what
 * the full description gives for every hold: the same category, label, held ranks, high cards, wilds and penalties.
 */
const FAMILIES: GameFamilyId[] = ["jacks_or_better", "bonus_poker", "bonus_poker_deluxe", "double_bonus", "double_double_bonus", "deuces_wild"];
describe("training patterns", () => {
  for (const familyId of FAMILIES) {
    it(`${familyId}: match the full description for every hold of one deal in every 4`, () => {
      const hands = getCanonicalHands(), cache = new Map<number, HeldShape>();
      let checked = 0;
      for (let h = 0; h < hands.length; h += 4) {
        for (let mask = 0; mask < 32; mask++) {
          const { shape, flushPenalty, straightPenalty } = trainingShape(hands[h].hand, mask, familyId, cache);
          const fast = patternOf(shape, flushPenalty, straightPenalty);
          const full = describeHoldUnchecked(hands[h].hand, mask, familyId);
          if (fast.label !== full.label || fast.base !== full.base || fast.heldRanks !== full.heldRanks || fast.highCards !== full.highCards ||
              fast.wilds !== full.wilds || fast.flushPenalty !== full.flushPenalty || fast.straightPenalty !== full.straightPenalty) {
            expect({ hand: hands[h].hand, mask, ...fast, discardedRanks: full.discardedRanks }).toEqual({ hand: hands[h].hand, mask, ...full });
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(1_000_000);
      expect(cache.size).toBeLessThan(checked / 10); // held sets repeat: that's the saving
    }, 120_000);
  }
});
