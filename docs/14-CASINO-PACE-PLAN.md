# Casino-Pace Mode — plan

Spec: F4.8 in `02-PRODUCT-SPEC.md`; "Speed training link" in `07-CRUISE-REWARDS.md` §4.
Status: **built** (see replit.md "Casino-Pace Mode").

Goal: train toward the hands per hour your trip needs while keeping your accuracy, and see what speed costs: "At 900
hands/hr your mistakes cost 0.25% of return, adding $0.04 a point, but save 6 hours on this trip."

## Decisions (from the owner)
1. **Target pace** defaults to the hands per hour the current trip needs (points still needed × $15 ÷ the machine's
   bet ÷ casino hours left). Editable.
2. **Accuracy bar**: your choice, default **99.9% of the EV of perfect play** (choices 99.5, 99.8, 99.9, 99.95%).
3. **Feedback**: your choice: quiet (mistakes in the report at the end, like a real machine; the default), shown after
   each draw, or a warning before the draw (which slows you down).
4. **Full Free Play hands**: deal, hold, draw, with bets and payouts from the machine's wallet.

## A pace session
- A Free Play session with `pace = { targetHandsPerHour, accuracyPct, tripId? }`; dealing, betting, statistics and
  practice pace are unchanged. Started from the Cruise page ("Train your pace") on one of your machines.
- **Pace meter** in the session room: hands per hour over the last 20 hands and for the session (gaps over 60 s are
  breaks, as in the tracker), against the target; with quiet feedback, accuracy stays hidden until the session closes.
  Accuracy = EV kept: Σ EV of your holds ÷ Σ EV of the best holds. Also what your mistakes cost: % of return and $ per
  point.

## The trade-off
- From your Free Play hands (pace sessions and ordinary ones), each hand's pace = the time since the previous hand in
  the same session (a gap over 60 s isn't a pace). Bands: under 500, 500–700, 700–900, 900–1,100, 1,100+ hands/hr.
- Per band: hands, EV kept, mistakes' cost (% of return and extra $ per point), and the hours this trip's remaining
  target would take at that pace.
- **Best pace** = the fastest band (≥ 50 hands) that meets your accuracy bar; the planner offers it as your pace.

## Out of scope
Pace targets that change during a session; per-game trade-off tables (the bands mix games, in % of return).
