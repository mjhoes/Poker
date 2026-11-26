import { describe, expect, it } from "vitest";
import { LADDER_STREAK, ladderAnswer, ladderNewest, ladderPick, switcherDealt, switcherNext, switcherRoundDealt } from "../src/training/plans";
import type { LadderState, SwitcherState } from "../src/training/plans";

const ladder = (over: Partial<LadderState> = {}): LadderState => ({ tier: "Expert", lines: [0, 1, 3, 4], step: 1, streak: 0, pending: null, ...over });
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe("Strategy Ladder", () => {
  it("starts on the first line only, then mixes 60% newest with even review of the lines before", () => {
    expect(ladderPick(ladder(), () => 0.99)).toEqual({ line: 0, isNew: true });
    const random = seeded(), counts = new Map<number, number>();
    for (let i = 0; i < 20_000; i++) { const pick = ladderPick(ladder({ step: 3 }), random); counts.set(pick.line, (counts.get(pick.line) ?? 0) + 1); }
    expect(counts.get(3)! / 20_000).toBeCloseTo(0.6, 1); // the newest of the practicable lines (chart line 3; line 2 is skipped)
    expect(counts.get(0)! / 20_000).toBeCloseTo(0.2, 1);
    expect(counts.get(1)! / 20_000).toBeCloseTo(0.2, 1);
    expect(counts.has(4)).toBe(false); // not unlocked yet
  });
  it("climbs after four right in a row on the newest line; a mistake there resets the run; review answers don't count", () => {
    let state = ladder({ step: 2 });
    for (let i = 0; i < LADDER_STREAK - 1; i++) state = ladderAnswer({ ...state, pending: 1 }, true);
    expect([state.step, state.streak, state.pending]).toEqual([2, 3, null]);
    state = ladderAnswer({ ...state, pending: 0 }, false); // a review mistake
    expect([state.step, state.streak]).toEqual([2, 3]);
    expect(ladderAnswer({ ...state, pending: 1 }, false).streak).toBe(0);
    state = ladderAnswer({ ...state, pending: 1 }, true);
    expect([state.step, state.streak, ladderNewest(state)]).toEqual([3, 0, 3]);
    expect(ladderAnswer({ ...state, pending: null }, true)).toEqual({ ...state, pending: null }); // nothing dealt
  });
  it("past the last line, reviews every line equally", () => {
    const done = ladder({ step: 5 });
    expect(ladderNewest(done)).toBeNull();
    const random = seeded(7), seen = new Set<number>();
    for (let i = 0; i < 200; i++) { const pick = ladderPick(done, random); expect(pick.isNew).toBe(false); seen.add(pick.line); }
    expect([...seen].sort()).toEqual([0, 1, 3, 4]);
    expect(ladderAnswer({ ...done, pending: 4 }, true).step).toBe(5);
  });
});

describe("Pay Table Switcher", () => {
  const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
  it("deals a round's hand on the machine's table, then the same cards on each other table, then a new round", () => {
    let state: SwitcherState = { tables: [a, b, c], round: null };
    expect(switcherNext(state, () => 0.5)).toEqual({ paytableId: a, switcher: { others: [b, c], differ: true } });
    expect(switcherNext(state, () => 0.9)).toEqual({ paytableId: a, switcher: { others: [b, c], differ: false } });
    state = switcherDealt(state, [1, 2, 3, 4, 5], false);
    expect(switcherNext(state, () => 0.5)).toEqual({ paytableId: b, hand: [1, 2, 3, 4, 5] });
    state = switcherDealt(state, [1, 2, 3, 4, 5], true);
    expect(switcherRoundDealt(state)).toBe(false);
    expect(switcherNext(state, () => 0.5)).toEqual({ paytableId: c, hand: [1, 2, 3, 4, 5] });
    state = switcherDealt(state, [1, 2, 3, 4, 5], true);
    expect(switcherRoundDealt(state)).toBe(true);
    expect(switcherNext(state, () => 0.5)).toMatchObject({ paytableId: a, switcher: { others: [b, c] } });
  });
});
