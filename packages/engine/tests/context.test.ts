import { describe, expect, it } from "vitest";
import { analyzeContext, CONTEXT_MIN_HANDS } from "../src/context";
import type { ContextDecision, ContextReport } from "../src/context";

/*
 * Context analysis compares each situation with what its hands would explain: the player's own error rate on each hand
 * type. A situation that only gets harder hands must not look worse; one where the same hands go wrong more must.
 */
let clock = Date.UTC(2026, 10, 1, 12);
function decision(overrides: Partial<ContextDecision> = {}): ContextDecision {
  clock += 10_000;
  return {
    sessionId: "s1", paytableId: "jacks", createdAt: clock, bestLabel: "EASY", evLoss: 0, decisionMs: 4000,
    handIndexInSession: 50, priorOutcome: null, firstAnswer: true, mode: "drill", switcherSession: false, inScope: true, ...overrides,
  };
}
/** `count` hands of a type, `mistakes` of them wrong (spread evenly, so one mistake doesn't predict the next). */
const hands = (count: number, mistakes: number, overrides: Partial<ContextDecision>) =>
  Array.from({ length: count }, (_, index) => decision({
    // Each in its own session, so the previous-hand factor stays out of these tests.
    sessionId: `s${clock}`, ...overrides, evLoss: Math.floor((index + 1) * mistakes / count) > Math.floor(index * mistakes / count) ? 0.5 : 0,
  }));
const bucket = (report: ContextReport, factor: string, id: string) => report.factors.find(item => item.id === factor)!.buckets.find(item => item.id === id)!;

describe("context analysis", () => {
  it("doesn't blame fast decisions for getting harder hands", () => {
    // Fast decisions get only the hard hand type; slow ones only the easy one. Within each type, speed changes nothing.
    const report = analyzeContext([
      ...hands(200, 60, { bestLabel: "HARD", decisionMs: 1000 }), ...hands(100, 30, { bestLabel: "HARD", decisionMs: 6000 }),
      ...hands(200, 4, { bestLabel: "EASY", decisionMs: 6000 }), ...hands(100, 2, { bestLabel: "EASY", decisionMs: 1000 }),
    ]);
    const fast = bucket(report, "decision_time", "under_2s");
    expect(fast.ratePct).toBeCloseTo(62 / 300 * 100, 6); // raw: far above the 5–10 s rate…
    expect(bucket(report, "decision_time", "5_10s").ratePct).toBeCloseTo(34 / 300 * 100, 6);
    expect(Math.abs(fast.excessPer100)).toBeLessThan(fast.ciPer100); // …but the hands explain it
    expect(fast.counts).toBe(false);
    expect(report.findings).toEqual([]);
  });

  it("finds fast decisions going wrong more on the same hands, with an interval", () => {
    const report = analyzeContext([
      ...hands(300, 90, { bestLabel: "HARD", decisionMs: 1000 }), ...hands(300, 15, { bestLabel: "HARD", decisionMs: 6000 }),
    ]);
    const fast = bucket(report, "decision_time", "under_2s"), slow = bucket(report, "decision_time", "5_10s");
    expect([fast.n, fast.errors]).toEqual([300, 90]);
    // Each hand's expected chance: the type's rate without that hand, shrunk toward the overall rate (here the same type).
    const overall = 105 / 600, others = 600 - 1 + 5;
    expect(fast.expected).toBeCloseTo(90 * (104 + 5 * overall) / others + 210 * (105 + 5 * overall) / others, 6);
    expect(fast.excessPer100).toBeGreaterThan(10);
    expect(fast.counts && slow.counts).toBe(true);
    expect(report.findings.map(item => [item.factor, item.bucket, item.worse])).toEqual([["decision_time", "under_2s", true], ["decision_time", "5_10s", false]]);
    expect(fast.lossPer100).toBeCloseTo(90 * 0.5 / 3, 6);
    expect(fast.expectedLossPer100).toBeLessThan(fast.lossPer100);
  });

  it(`needs ${CONTEXT_MIN_HANDS} hands before a difference counts`, () => {
    const report = analyzeContext([...hands(CONTEXT_MIN_HANDS - 1, 20, { decisionMs: 1000 }), ...hands(300, 3, {})]);
    expect(bucket(report, "decision_time", "under_2s").counts).toBe(false);
  });

  it("places hands by session position, table changes, the previous answer and the previous draw", () => {
    const report = analyzeContext([
      decision({ handIndexInSession: 1, sessionId: "a", paytableId: "jacks" }),
      decision({ handIndexInSession: 2, sessionId: "a", paytableId: "jacks", evLoss: 0.4 }),
      // Another table soon after: the next 10 hands are "after a change", the 11th isn't.
      ...Array.from({ length: 11 }, (_, index) => decision({ handIndexInSession: index + 1, sessionId: "b", paytableId: "bonus" })),
      // Pay Table Switcher hands are left out of table changes (but a later hand on another table follows them).
      decision({ sessionId: "sw", paytableId: "deuces", switcherSession: true }),
      // Free Play: how the previous draw paid.
      decision({ sessionId: "f", mode: "free_play", priorOutcome: "NOTHING,NOTHING,NOTHING" }),
      decision({ sessionId: "f", mode: "free_play", priorOutcome: "NOTHING,JACKS_OR_BETTER" }),
      decision({ sessionId: "f", mode: "free_play", priorOutcome: "FOUR_KIND" }),
      decision({ sessionId: "g", mode: "drill", priorOutcome: "mistake" }),
      decision({ inScope: false, sessionId: "z" }),
      decision({ firstAnswer: false, sessionId: "a" }),
      // Another table after a long break: not a change. Its previous answer in session "a" was the mistake.
      decision({ createdAt: clock + 5 * 3_600_000, sessionId: "a", paytableId: "bonus", handIndexInSession: 400 }),
    ]);
    expect(report.n).toBe(19);
    expect(bucket(report, "hand_in_session", "1_25").n).toBe(13);
    expect(bucket(report, "hand_in_session", "301_plus").n).toBe(1);
    // b's first 10; then f's three and g's one, after the switcher's deuces hand.
    expect(bucket(report, "table_change", "first_hands").n).toBe(14);
    expect(bucket(report, "table_change", "first_hands").n + bucket(report, "table_change", "later").n).toBe(18);
    expect(bucket(report, "previous_hand", "after_mistake").n).toBe(1);
    expect(bucket(report, "previous_draw", "after_loss").n).toBe(1);
    expect(bucket(report, "previous_draw", "after_win").n).toBe(1);
    expect(bucket(report, "previous_draw", "after_big_win").n).toBe(1);
  });
});
