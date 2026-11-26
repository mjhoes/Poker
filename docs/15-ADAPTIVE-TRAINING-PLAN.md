# Adaptive training — plan

Spec: F4.3–F4.7 in `02-PRODUCT-SPEC.md`; Tech Spec §6 (weakness, mix) and §3.8 (drill generator).
Status: **Round A in progress** (mastery, spaced repetition, Weakness Trainer, Close Calls). Round B: Strategy Ladder
and Pay Table Switcher.

Goal: spend practice where mistakes cost the most, and keep what you've learned from fading.

## Decisions (from the owner)
1. Two rounds (A now, B next).
2. Close calls: a **slider** per session for how close the best two holds must be.
3. Strategy Ladder (Round B): you choose the chart each time; default Expert.
4. Daily reviews: an **adjustable cap** (default 50) plus **Keep going** for the due cards beyond it.

## A1 — Cards, mastery and spaced repetition
- A **card** = a hold category for a game family (e.g. Jacks or Better "4 to a flush"), the `categoryMastery` table.
  Every first decision (not corrections) in any mode updates the card of the hand's best hold: right/wrong counts
  (Beta(1,1) mastery = share right), EV lost, and **FSRS** scheduling.
- FSRS (v4.5 default weights, 90% target recall): grade Good when right, Again when wrong. A due or new card is
  scheduled by FSRS; a card answered before it's due only updates its counts, unless the answer is wrong, which is a
  lapse (FSRS Again: back in 10 minutes, lower stability).
- **Priority** of a due card = its mistake rate × average EV lost per mistake (what it costs per hand).

## A2 — Today's review
- Due cards for the chosen machine's game, most costly first. **Cap** (default 50, set on the Train page) = card
  reviews per day across all games; when reached, the session says so and offers **Keep going** with the rest due.
- A review session is a Rapid Drill session with `training = { kind: "review", keepGoing }`; each deal asks for a hand
  whose best hold is the next card's category.

## A3 — Weakness Trainer
- At start, your top 5 weakness pairs (Statistics' confusion pairs on that table, by EV lost, recency-weighted) whose
  cards haven't graduated (mistake rate < 2% over 30+ hands). Each deal: 70% one of those pairs (sampled by weight),
  20% a due review card, 10% an ordinary real-distribution hand.

## A4 — Close Calls
- Rapid Drill hands where the best two holds are within the slider's gap (0.01–0.50 credits per coin bet, default
  0.10). Shows how close each one was after you answer (the existing feedback already shows both EVs).

## A5 — Train page
- `#/train` in the nav: machine picker (decides game and pay table), Today's review (due, done, cap, Start / Keep
  going), Weakness Trainer (top patterns with their cost), Close Calls (slider, Start), and your cards (mastery, next
  review). The session room shows the training plan and the review count.

## Out of scope this round
Strategy Ladder and Pay Table Switcher (Round B), heuristic cards (F6), recency decay inside the mastery counts.
