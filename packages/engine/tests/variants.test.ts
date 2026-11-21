import { describe, expect, it } from "vitest";
import { GAME_FAMILIES, standardVariant } from "../src";
import type { GameFamilyId, PayTable } from "../src";

function fixture(familyId: GameFamilyId = "jacks_or_better"): PayTable {
  const pays: PayTable["pays"] = Object.fromEntries(
    GAME_FAMILIES[familyId].handRanks.filter(rank => rank !== "NOTHING")
      .map(rank => [rank, rank === "ROYAL_FLUSH" || rank === "NATURAL_ROYAL"
        ? [250, 500, 750, 1000, 4000] : [1, 2, 3, 4, 5]]),
  );
  return { id: "test-only", familyId, pays, source: "manual" };
}

describe("standard variant", () => {
  it.each(Object.keys(GAME_FAMILIES) as GameFamilyId[])("aligns coin-column values for %s", familyId => {
    const payTable = fixture(familyId);
    for (let coins = 1; coins <= 5; coins++) {
      const vector = standardVariant.valueVector(payTable, coins, {});
      expect(vector[0]).toBe(coins === 5 ? 4000 : 250 * coins);
      expect(vector.slice(1, -1).every(value => value === coins)).toBe(true);
      expect(vector.at(-1)).toBe(0);
    }
  });

  it("charges all lines and resets state without mutating the input", () => {
    expect(standardVariant.kind).toBe("standard");
    expect(standardVariant.betCoins(5, 10)).toBe(50);
    const state = { lineMultipliers: [4, 2], level: 3 };
    expect(standardVariant.nextState(state, ["FLUSH"])).toEqual({});
    expect(state).toEqual({ lineMultipliers: [4, 2], level: 3 });
  });

  it("rejects invalid bets and payout tables", () => {
    for (const coins of [0, 6, 1.5, NaN]) {
      expect(() => standardVariant.valueVector(fixture(), coins, {})).toThrow();
      expect(() => standardVariant.betCoins(coins, 1)).toThrow();
    }
    for (const lines of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(() => standardVariant.betCoins(5, lines)).toThrow();
    }
    expect(() => standardVariant.valueVector({ ...fixture(), pays: {} }, 5, {})).toThrow();
    expect(() => standardVariant.valueVector({
      ...fixture(), pays: { ...fixture().pays, ROYAL_FLUSH: [-1, 500, 750, 1000, 4000] },
    }, 5, {})).toThrow();
    expect(() => standardVariant.valueVector({
      ...fixture(), pays: { ...fixture().pays, NOTHING: [1, 0, 0, 0, 0] },
    }, 5, {})).toThrow();
  });
});
