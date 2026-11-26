import { describe, expect, it } from "vitest";
import { bestPace, mistakeCostPerPointCents, neededPace, paceBands, sessionPace } from "../src/cruise/pace";
import type { PaceDecision } from "../src/cruise/pace";

/** Hands `gapMs` apart; every `mistakeEvery`-th hand loses `loss` credits (per line, 5 coins) from a best EV of 5. */
function hands(sessionId: string, count: number, gapMs: number, start = 0, mistakeEvery = 0, loss = 0.5): PaceDecision[] {
  return Array.from({ length: count }, (_, index) => {
    const mistake = mistakeEvery > 0 && (index + 1) % mistakeEvery === 0;
    return { sessionId, createdAt: start + index * gapMs, isCorrection: false, bestEv: 5, chosenEv: mistake ? 5 - loss : 5, evLoss: mistake ? loss : 0, coins: 5 };
  });
}

describe("a session's pace", () => {
  it("counts gaps up to a minute, and the last 20 hands for the meter", () => {
    // 30 hands at 6 s (600/hr), a 5-minute break, then 25 hands at 4 s (900/hr).
    const rows = [...hands("a", 30, 6000), ...hands("a", 25, 4000, 30 * 6000 + 300_000)];
    const pace = sessionPace(rows);
    expect(pace.hands).toBe(55);
    expect(pace.activeMs).toBe(29 * 6000 + 24 * 4000);
    expect(pace.handsPerHour).toBeCloseTo(53 / ((29 * 6000 + 24 * 4000) / 3_600_000), 9);
    expect(pace.recentHandsPerHour).toBeCloseTo(900, 9);
    expect(pace.evKeptPct).toBe(100);
    expect(sessionPace(hands("b", 4, 5000)).handsPerHour).toBeNull(); // too few to say
  });
  it("measures accuracy as EV kept and mistakes as a share of return, leaving corrections out", () => {
    const rows = hands("a", 10, 5000, 0, 5); // 2 mistakes of 0.5 from 50 of EV
    rows.push({ ...rows[4], isCorrection: true, chosenEv: 0, evLoss: 5 });
    const pace = sessionPace(rows);
    expect(pace.evKeptPct).toBeCloseTo(98, 9);
    expect(pace.errorCostPct).toBeCloseTo(2 * 0.5 / 5 * 100 / 10, 9); // 2% of return
  });
});

describe("the trade-off between speed and mistakes", () => {
  // Careful at 600/hr (no mistakes), quicker at 800/hr (1 in 100 loses 0.5), fast at 1,200/hr (1 in 20).
  const rows = [
    ...hands("slow", 101, 6000),
    ...hands("mid", 201, 4500, 0, 100),
    ...hands("fast", 101, 3000, 0, 20),
  ];
  const bands = paceBands(rows);
  it("puts each hand in the band of its own pace", () => {
    expect(bands.map(band => [band.from, band.hands])).toEqual([[0, 0], [500, 100], [700, 200], [900, 0], [1100, 100]]);
    expect(bands[1].meanHandsPerHour).toBeCloseTo(600, 9);
    expect(bands[2].meanHandsPerHour).toBeCloseTo(800, 9);
    expect(bands[1].evKeptPct).toBe(100);
    expect(bands[2].evKeptPct).toBeCloseTo(100 - 2 * 0.5 / 1000 * 100, 9); // 99.9
    expect(bands[4].evKeptPct).toBeCloseTo(99.5, 9); // 5 mistakes of 0.5 from 500 of EV
    expect(bands[4].errorCostPct).toBeCloseTo(5 * 0.5 / 5 * 100 / 100, 9); // 0.5% of return
  });
  it("picks the fastest band that keeps the bar", () => {
    expect(bestPace(bands, 99.9)?.from).toBe(700);
    expect(bestPace(bands, 99.95)?.from).toBe(500);
    expect(bestPace(bands, 99.5)?.from).toBe(1100);
    expect(bestPace(bands, 99.5, 101)?.from).toBe(700); // the fast band has too few hands
    expect(bestPace(bands, 99.5, 201)).toBeNull();
  });
  it("prices mistakes per point, and works out the pace a trip needs", () => {
    expect(mistakeCostPerPointCents(15, 0.25)).toBeCloseTo(3.75, 9); // 0.25% of return → $0.0375 a point
    expect(neededPace(2500, 15, 125, 40)).toBe(750);
    expect(neededPace(0, 15, 125, 40)).toBeNull();
    expect(neededPace(100, 15, 125, 0)).toBeNull();
  });
});
