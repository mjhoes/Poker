# Adaptive training, round B: Strategy Ladder and Pay Table Switcher

Status: **built**. Round A (docs/15-ADAPTIVE-TRAINING-PLAN.md) is merged. Both trainers are Rapid Drill sessions
started from the Train page, like round A's.

## Decisions (from the owner)

- Strategy Ladder: you choose the chart each time (Beginner, Intermediate or Expert); the default is Expert.

## B1: Strategy Ladder (F4.5)

Learn a strategy chart top-down, one line at a time, then mixed review.

- **Chart.** The machine's pay table, at the chosen tier. Charts are built for max bet, so a ladder session always deals
  at 5 coins (the bet is fixed, like a focused drill's). A table's training data is built the first time (a few seconds), and a custom table's charts too (longer).
- **Hands.** For each line, the deals where that line picks the hold *and* the chart's hold is the best play. The
  grade then agrees with the chart, so the ladder never marks a chart-correct hold wrong. A line with no such deal
  can't be practiced and is skipped (shown as "no deal to practice").
- **Climbing.** Step *n* unlocks lines 1…n of the practicable lines. At step 1 every hand is line 1; after that, 60% of
  hands are the newest line and 40% review an earlier line (each equally often, so rare lines get practice). Four
  right in a row on the newest line climbs a step; a mistake there resets the run. Past the last line the ladder is
  mixed review of every line.
- **Progress** is kept per pay table and chart, in the ladder sessions themselves: a new ladder session continues
  from the one with the newest progress (its own timestamp, not the session's), or starts over when asked.
- Answers still update review cards (round A), and decisions go to Statistics as usual.

## B2: Pay Table Switcher (F4.6)

The same hand on two or three pay tables of the same game, one after another: learn which plays change.

- **Tables.** The machine's table plus one or two others of the same game (built-in or yours), all at the machine's
  bet (fixed for the session: a different bet could change the best hold on its own). The Train page shows how often
  the best hold differs between them: a deal differs when no hold is optimal on both tables, ties included. A custom
  table an open Switcher compares can't be deleted until the session closes.
- **Rounds.** Each round deals one hand on the machine's table, then the same cards on each other table in turn. 75% of
  rounds use a hand whose best hold differs on at least one of the tables; 25% use any hand, so the answer isn't
  always "it changes". The machine screen shows the pay table of the hand in play.
- After the round's last table, the session panel compares the tables: each one's best hold and your answer.
- Each answer is a normal decision on that table (statistics, review cards).

## How it's built

- Engine: `chartLineIndex(list)` (`packages/engine/src/ladder.ts`) maps every deal to the chart line that picks its hold,
  mirroring the chart scorer, and lists each line's deals where that hold is a best play. `generateHand({ onlyIds })`
  deals from such a list.
- Worker: `ladderChart(paytableId, tier)`; `switcherDiffer(paytableId, others, coins)`; `prepareRound` targets
  `ladder: { tier, line }`, `switcher: { others, differ }` and `hand` (the same cards on another table, `paytableId`).
- Sessions: `training.ladder = { tier, lines, step, streak, pending }` and `training.switcher = { tables, round }`;
  `state.handPaytableId` is the table of a Switcher round's later hands (decisions record it). The ladder's bet is
  fixed at 5 coins (`fixedBet`). Pure rules in `apps/web/src/training/plans.ts`.

## Out of scope

Heuristic cards (F6), recency decay inside the mastery counts, ladder for Reference/Perfect charts.
