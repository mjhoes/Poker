import { describe, expect, it } from "vitest";
import { analyzeHandFast, getGameFamily, parseHand, standardVariant } from "@perfect-draw/engine";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { compareHolds, comparisonSummary, holdBreakdown, oneIn } from "../src/table/hold-breakdown";

const table = getLibraryPayTable("jacks-or-better-9-6");
const analysis = analyzeHandFast(parseHand("Ah Kh Qh 7h 7c"), standardVariant.valueVector(table, 5, {}), table.familyId);
const royalDraw = 0b00111, sevens = 0b11000;

describe("why one hold beats another", () => {
  it("rebuilds each hold's expected value exactly from chance × pay", () => {
    for (const result of analysis.results) {
      const breakdown = holdBreakdown(analysis, result.mask);
      expect(breakdown.rows.reduce((sum, row) => sum + row.ev, 0)).toBeCloseTo(result.ev, 10);
    }
  });
  it("shows the royal draw's value: one royal in 1,081 draws is worth 3.70 credits", () => {
    const breakdown = holdBreakdown(analysis, royalDraw);
    const royal = breakdown.rows.find(row => row.rank === "ROYAL_FLUSH")!;
    expect(breakdown.drawCount).toBe(1081);
    expect(royal.count).toBe(1);
    expect(royal.ev).toBeCloseTo(4000 / 1081, 10);
    expect(oneIn(royal.count, breakdown.drawCount)).toBe("1 in 1,081");
  });
  it("names the final hands that decide the comparison and summarises them in plain words", () => {
    const comparison = compareHolds(analysis, royalDraw, sevens);
    expect(comparison.delta).toBeCloseTo(analysis.results.find(r => r.mask === royalDraw)!.ev - analysis.results.find(r => r.mask === sevens)!.ev, 10);
    expect(comparison.decisive[0]).toBe("ROYAL_FLUSH");
    const text = comparisonSummary(comparison, { a: "The best hold", b: "Your hold" });
    expect(text).toMatch(/^The best hold is worth 2\.81 more credits per line, mostly from Royal Flush \(1 in 1,081 draws, \+3\.70\)/);
  });
  it("treats equal holds as equal", () => {
    const comparison = compareHolds(analysis, royalDraw, royalDraw);
    expect(comparisonSummary(comparison, { a: "A", b: "B" })).toContain("exactly the same");
  });
  it("counts only paying hands as wins, even when a custom table pays zero for a made hand", () => {
    // Jacks or better pays nothing here: holding a high pair can still lose on every draw.
    const vector = [...standardVariant.valueVector(table, 5, {})];
    const jacksIndex = getGameFamily(table.familyId).handRanks.indexOf("JACKS_OR_BETTER");
    vector[jacksIndex] = 0;
    const zeroPairs = analyzeHandFast(parseHand("Jh Jc 2s 5d 9h"), vector, table.familyId);
    const pairOnly = holdBreakdown(zeroPairs, 0b00011);
    const paying = pairOnly.rows.filter(row => row.pay > 0).reduce((sum, row) => sum + row.probability, 0);
    expect(pairOnly.winProbability).toBeCloseTo(paying, 12);
    expect(pairOnly.winProbability).toBeLessThan(0.5);
    // A hold whose only outcomes pay zero never wins.
    const allHeld = holdBreakdown(zeroPairs, 0b11111);
    expect(allHeld.ev).toBe(0);
    expect(allHeld.winProbability).toBe(0);
  });
});
