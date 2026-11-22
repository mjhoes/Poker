---
name: Practice integrity
description: Why training reports preserve first attempts and paid hands keep their outcomes across retries.
---

## Unassisted decisions versus assisted outcomes

Preserve the initial submitted decision even when warn-before-draw allows a
correction. Count one primary decision per hand in accuracy and EV-loss estimates;
retain corrections for review without treating them as independent hands.
Confirming an already recorded warning is not another decision.

**Why:** Otherwise a player can receive warnings on every mistake, select the
recommended hold, and appear to have played perfectly. The eventual payout may
legitimately follow the corrected hold, but that does not measure unassisted skill.

**How to apply:** Future statistics and effective-return estimates must distinguish
primary attempts from corrections. Do not substitute the final assisted draw for
the original error when reporting training accuracy or cost. This is decision
grading; strategy-chart returns still require strict replay of the chart itself.

## Stable outcomes during recovery

A paid round's possible draw outcomes must remain fixed across reloads and failed
settlement attempts.

**Why:** Worker calculations happen outside the financial transaction. Retrying a
failed request must not silently deal a new outcome or permit repeated rerolls.

**How to apply:** Commit the deal and its reproducible draw orders with the bet.
Resolve retries from that persisted round, and settle at most once. Do not replace
an unfinished paid round with a fresh deal or silently abandon its wager on close.
