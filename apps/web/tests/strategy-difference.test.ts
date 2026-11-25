import { describe, expect, it } from "vitest";
import { analyzeHandFast, canonicalizeHand, cardRank, parseHand, standardVariant } from "@perfect-draw/engine";
import type { GameAnalysis, GameHandResult, Hand } from "@perfect-draw/engine";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { compareStrategies } from "../src/worker/strategy-difference";

const ddb = getLibraryPayTable("double-double-bonus-9-6");
const royalOnly = { ...ddb, pays: Object.fromEntries(Object.entries(ddb.pays).map(([rank, row]) => [rank, rank === "ROYAL_FLUSH" ? row : [0, 0, 0, 0, 0]])) };
const vector = (table: { familyId: typeof ddb.familyId; pays: Record<string, readonly number[]> }) => standardVariant.valueVector(table as never, 5, {});

/**
 * One deal's stored result (best and second-best hold only), as the full analysis keeps it. `keep` names which two
 * tied holds happen to be stored; otherwise the two highest.
 */
function stored(hand: Hand, values: readonly number[], keep?: [number, number]): GameHandResult {
  const results = [...analyzeHandFast(hand, values, ddb.familyId).results].sort((a, b) => b.ev - a.ev);
  const [first, second] = keep ? keep.map(mask => results.find(row => row.mask === mask)!) : results;
  if (keep) expect(results[0].ev - first.ev).toBeLessThan(1e-9);
  return { weight: 1, bestMask: first.mask, secondMask: second.mask, bestLabel: first.label, secondLabel: second.label, ev: first.ev, secondEv: second.ev };
}
const analysis = (values: readonly number[], perHand: Map<number, GameHandResult>): Pick<GameAnalysis, "familyId" | "valueVector" | "perHand"> =>
  ({ familyId: ddb.familyId, valueVector: values, perHand });

describe("comparing strategy between tables", () => {
  const { id, hand } = canonicalizeHand(parseHand("Jc Kd Ah 4s 7s"));
  const maskOf = (rank: number) => 1 << hand.findIndex(card => cardRank(card) === rank);
  const jack = maskOf(9), king = maskOf(11), ace = maskOf(12);

  it("doesn't count a change when a third tied hold is optimal on both tables", () => {
    // Royal-only: holding the J, K or A alone are equally good. The stored result happens to keep J and K.
    const mine = stored(hand, vector(royalOnly), [jack, king]);
    expect([mine.bestMask, mine.secondMask]).toEqual([jack, king]);
    expect(mine.ev - mine.secondEv).toBeLessThan(1e-9);
    const base = stored(hand, vector(ddb));
    expect(base.bestMask).toBe(ace);
    const hands = new Map([[id, hand]]);
    const result = compareStrategies(analysis(vector(royalOnly), new Map([[id, mine]])), analysis(vector(ddb), new Map([[id, base]])), hands);
    expect(result.differPct).toBe(0);
  });

  it("counts a real change, by weight, with examples", () => {
    const other = canonicalizeHand(parseHand("2c 2d 8h 9s Ks"));
    const hands = new Map<number, Hand>([[id, hand], [other.id, other.hand]]);
    const fake = (best: number, second: number, ev: number, secondEv: number, weight: number): GameHandResult =>
      ({ weight, bestMask: best, secondMask: second, bestLabel: `hold ${best}`, secondLabel: "", ev, secondEv });
    const mine = analysis(vector(ddb), new Map([[id, fake(1, 2, 10, 5, 3)], [other.id, fake(3, 4, 10, 5, 1)]]));
    const base = analysis(vector(ddb), new Map([[id, fake(2, 1, 10, 5, 3)], [other.id, fake(3, 4, 10, 5, 1)]]));
    const result = compareStrategies(mine, base, hands);
    expect(result.differPct).toBeCloseTo(75, 10);
    expect(result.examples).toEqual([{ hand: [...hand], best: "hold 1", baseBest: "hold 2", dealsPct: 75 }]);
  });
});
