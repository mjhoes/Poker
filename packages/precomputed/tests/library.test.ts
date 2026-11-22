import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PAY_TABLE_LIBRARY, analysisKey, getLibraryPayTable, payTableId } from "@perfect-draw/paytables";
import { ENGINE_VERSION, getGameFamily, standardVariant } from "@perfect-draw/engine";

describe("library identity and payout conventions", () => {
  it("provides all eight launch tables with unique, reproducible SHA-256 IDs", () => {
    expect(PAY_TABLE_LIBRARY).toHaveLength(8);
    expect(new Set(PAY_TABLE_LIBRARY.map(table => table.id)).size).toBe(8);
    for (const table of PAY_TABLE_LIBRARY) {
      expect(table.id).toMatch(/^[a-f0-9]{64}$/);
      expect(getLibraryPayTable(table.slug)).toBe(table);
      expect(getLibraryPayTable(table.id)).toBe(table);
      expect(table.sources).toHaveLength(2);
      expect(payTableId(table)).toBe(table.id);
      const family = getGameFamily(table.familyId);
      const rows = family.handRanks.map(rank => [rank, table.pays[rank]]);
      const expected = createHash("sha256").update(JSON.stringify({ familyId: table.familyId, rows })).digest("hex");
      expect(table.id).toBe(expected);
      expect(payTableId({ familyId: table.familyId, pays: Object.fromEntries(Object.entries(table.pays).reverse()) })).toBe(table.id);
    }
    expect(() => getLibraryPayTable("missing")).toThrow();
  });

  it("retains max-coin royal bonuses, split quads, and NSUD's different pays", () => {
    for (const table of PAY_TABLE_LIBRARY) {
      expect(standardVariant.valueVector(table, 1, {})[0]).toBe(250);
      expect(standardVariant.valueVector(table, 5, {})[0]).toBe(4000);
    }
    const nsud = getLibraryPayTable("deuces-wild-nsud");
    expect(nsud.pays.FIVE_KIND).toEqual([16, 32, 48, 64, 80]);
    expect(nsud.pays.FOUR_KIND?.[4]).toBe(20);
    const ddb = getLibraryPayTable("double-double-bonus-9-6");
    expect(ddb.pays.FOUR_ACES_W_234?.[4]).toBe(2000);
    expect(ddb.pays.FOUR_234_W_A234?.[4]).toBe(800);
  });

  it("cache keys distinguish family, vector, normalization, and engine version", () => {
    const vector = [4000, 250, 125, 45, 30, 20, 15, 10, 5, 0];
    const key = analysisKey("jacks_or_better", vector, 5);
    const expected = createHash("sha256").update(JSON.stringify({
      engineVersion: ENGINE_VERSION, familyId: "jacks_or_better", valueVector: vector, betCoins: 5,
    })).digest("hex");
    expect(key).toBe(expected);
    expect(key).not.toBe(analysisKey("bonus_poker_deluxe", vector, 5));
    expect(key).not.toBe(analysisKey("jacks_or_better", vector, 1));
    expect(key).not.toBe(analysisKey("jacks_or_better", vector.map(value => value * 2), 5));
  });
});
