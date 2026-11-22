import { expect, it } from "vitest";
import { analyzeGame } from "../src";

it("reproduces the full-pay JoB return and normalized variance", () => {
  const progress: number[] = [];
  const analysis = analyzeGame("jacks_or_better", [4000, 250, 125, 45, 30, 20, 15, 10, 5, 0],
    value => progress.push(value.completed), { betCoins: 5 });
  expect(analysis.returnPct).toBeCloseTo(99.543904, 5);
  expect(analysis.variance).toBeCloseTo(19.5147, 3);
  expect(analysis.rankProbs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  expect(analysis.perHand.size).toBe(134459);
  expect(progress[0]).toBe(0);
  expect(progress.at(-1)).toBe(134459);
}, 120_000);
