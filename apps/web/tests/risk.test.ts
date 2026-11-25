import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { outcomesFrom, simulateRisk } from "../src/worker/risk";

const manifest = JSON.parse(readFileSync(new URL("../../../packages/precomputed/assets/manifest.json", import.meta.url), "utf8")) as {
  entries: { slug: string; rankProbs: number[]; valueVector: number[]; betCoins: number; returnPct: number; variance: number }[];
};
const jacks = manifest.entries.find(entry => entry.slug === "jacks-or-better-9-6")!;
const outcomes = outcomesFrom(jacks.rankProbs, jacks.valueVector, jacks.betCoins);

describe("luck band (07-CRUISE-REWARDS.md §3)", () => {
  it("uses the engine's distribution: its mean and variance match the table's return and variance", () => {
    const band = simulateRisk({ outcomes, hands: 30_000, betCents: 125 });
    expect(band.meanCents / (30_000 * 125)).toBeCloseTo(jacks.returnPct / 100 - 1, 9);
    expect(band.sdCents).toBeCloseTo(Math.sqrt(30_000 * jacks.variance) * 125, 6);
  });
  it("matches the spec's example: 37,500 of coin-in on 9/6 Jacks, ±1 SD ≈ $950 at $1.25 and ≈ $1,900 at $5", () => {
    const quarters = simulateRisk({ outcomes, hands: 30_000, betCents: 125 });
    const dollars = simulateRisk({ outcomes, hands: 7_500, betCents: 500 });
    expect(quarters.meanCents).toBeCloseTo(-17_103, -1); // expected loss ≈ $171 ($173 with the spec's rounded return)
    expect(Math.round(quarters.sdCents / 5000) * 50).toBe(950);
    expect(Math.round(dollars.sdCents / 10000) * 100).toBe(1900);
    // The simulated band is skewed by royals: the median loses more than the mean.
    expect(quarters.p50Cents).toBeLessThan(quarters.meanCents);
    expect(quarters.p10Cents).toBeLessThan(quarters.p50Cents);
    expect(quarters.p90Cents).toBeGreaterThan(0);
    // Its spread is close to ±1.28 SD.
    expect((quarters.p90Cents - quarters.p10Cents) / quarters.sdCents).toBeGreaterThan(2.2);
    expect((quarters.p90Cents - quarters.p10Cents) / quarters.sdCents).toBeLessThan(2.9);
    expect(quarters.aheadShare).toBeGreaterThan(0.2);
    expect(quarters.aheadShare).toBeLessThan(0.5);
  });
  it("gives the same band either way at the switch-over size", () => {
    const direct = simulateRisk({ outcomes, hands: 2000, betCents: 125, method: "direct", trials: 6000 });
    const mixed = simulateRisk({ outcomes, hands: 2000, betCents: 125, method: "mixed", trials: 6000 });
    expect(direct.method).toBe("direct");
    for (const key of ["p10Cents", "p50Cents", "p90Cents"] as const) {
      expect(Math.abs(direct[key] - mixed[key])).toBeLessThan(0.08 * direct.sdCents);
    }
  });
  it("takes mistakes off every hand, and repeats exactly for a seed", () => {
    const perfect = simulateRisk({ outcomes, hands: 10_000, betCents: 125, seed: 7 });
    const sloppy = simulateRisk({ outcomes, hands: 10_000, betCents: 125, seed: 7, mistakePct: 0.35 });
    expect(perfect.p50Cents - sloppy.p50Cents).toBeCloseTo(10_000 * 125 * 0.0035, 6);
    expect(simulateRisk({ outcomes, hands: 10_000, betCents: 125, seed: 7 })).toEqual(perfect);
  });
});
