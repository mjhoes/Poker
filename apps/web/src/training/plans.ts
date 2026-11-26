import type { Session } from "@perfect-draw/shared";

/*
 * Round B's plans (docs/16-ADAPTIVE-TRAINING-ROUND-B.md), pure and unit-tested: how the Strategy Ladder climbs a chart
 * and how the Pay Table Switcher walks one hand across its tables.
 */

export type LadderState = NonNullable<NonNullable<Session["training"]>["ladder"]>;
export type SwitcherState = NonNullable<NonNullable<Session["training"]>["switcher"]>;

/** Right answers in a row on the newest line that climb a step. */
export const LADDER_STREAK = 4;
/** At a step past the first: the share of hands on the newest line (the rest review earlier lines). */
export const LADDER_NEW_SHARE = 0.6;

/** The chart line (index into the chart) the newest unlocked line is, or null once every line is learned (mixed review). */
export const ladderNewest = (state: LadderState) => state.step <= state.lines.length ? state.lines[state.step - 1] : null;

/**
 * The next hand's line. Step 1: always the first line. Later: 60% the newest line, 40% one of the earlier lines, each
 * equally often (so rare lines get practice). Past the last line: every line equally often.
 */
export function ladderPick(state: LadderState, random: () => number): { line: number; isNew: boolean } {
  const newest = ladderNewest(state);
  const pickFrom = (count: number) => state.lines[Math.min(count - 1, Math.floor(random() * count))];
  if (newest === null) return { line: pickFrom(state.lines.length), isNew: false };
  if (state.step === 1 || random() < LADDER_NEW_SHARE) return { line: newest, isNew: true };
  return { line: pickFrom(state.step - 1), isNew: false };
}

/** After a first decision on the hand in play: four right in a row on the newest line climbs a step; a mistake there resets the run. */
export function ladderAnswer(state: LadderState, correct: boolean): LadderState {
  if (state.pending === null) return state;
  let { step, streak } = state;
  if (state.pending === ladderNewest(state)) {
    streak = correct ? streak + 1 : 0;
    if (streak >= LADDER_STREAK) { step++; streak = 0; }
  }
  return { ...state, step, streak, pending: null };
}

/** A Switcher round's share of hands whose best hold differs on another table (the rest are any hand). */
export const SWITCHER_DIFFER_SHARE = 0.75;

/** The next Switcher deal: the round's same cards on its next table, or a new round's hand on the machine's table. */
export function switcherNext(state: SwitcherState, random: () => number) {
  const round = state.round;
  if (round && round.next < state.tables.length) return { paytableId: state.tables[round.next], hand: round.hand };
  return { paytableId: state.tables[0], switcher: { others: state.tables.slice(1), differ: random() < SWITCHER_DIFFER_SHARE } };
}
/** After a Switcher deal: a new round starts on the machine's table; a continued one moves to its next table. */
export function switcherDealt(state: SwitcherState, hand: readonly number[], continued: boolean): SwitcherState {
  return continued && state.round
    ? { ...state, round: { hand: state.round.hand, next: state.round.next + 1 } }
    : { ...state, round: { hand: [...hand], next: 1 } };
}
/** Whether the round in play has been dealt on every table (its comparison can show once the last hand is answered). */
export const switcherRoundDealt = (state: SwitcherState) => !!state.round && state.round.next >= state.tables.length;
