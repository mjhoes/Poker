# Cruise Rewards Tracker — plan

Spec: `07-CRUISE-REWARDS.md`; Prompt 7b in `05-REPLIT-AGENT-PROMPTS.md`. Casino-Pace Mode (F4.8) follows in the next
round; this round measures practice pace so the planner can use it.
Status: **built** (see replit.md "Cruise rewards tracker").

Goal: know what each reward point really costs, and whether the trip's target is reachable in the casino hours left.
Training lowers the cost of a point; pace decides the time. The app shows both from what you enter at the machine.

## Decisions (from the owner)
1. **Points:** coin-in accumulates across sessions; a point is earned each time the running total passes the next full
   $15. So the remainder carries over between sessions (rounding rule `carryover`, the default; per-session floor and
   fractional stay as options for other programs).
2. **Free play earns no points.** Coin-in that earns points is cash coin-in only.
3. **Coin-in comes from points.** The machine shows points at the start and at cash-out; coin-in ≈ Δpoints × $15,
   shown as "about $X (within $15)" because of the carried remainder. Hand count × bet and a time-based estimate are
   fallbacks when points weren't read.
4. **Luck band included:** 10th–90th percentile result from a simulation over the pay table's real hand distribution.

## C1 — Program, trips, days
- Built-in program **Royal Caribbean Club Royale** (casino: Casino Royale): $15 per point, carryover, free play earns
  nothing, tiers Prime 2,500 / Signature 25,000 / Masters 100,000 marked "check current terms". All editable.
- **Trip:** ship, sail dates (days generated from the dates, each sea or port with planned casino hours: sea 6 h,
  port 2 h by default), target points, points on the card at the start (optional), notes.
- Points so far = starting points + points earned this trip; progress = points so far ÷ target.

## C2 — Live casino session
- **Start:** pick one of your machines or a pay table, denomination, coins; points on the machine now (optional);
  cash in. One live session at a time.
- **Timer from timestamps** (start/pause/resume segments), so it survives reloads, closed tabs and a locked phone.
  Pause reasons: drink, break, hand pay (with the amount; W-2G hand pays ≥ $1,200), machine fault, other.
- Quick actions: **Add cash**, **Points now** (latest reading), pause/resume, **Cash out**.
- **Cash out:** final points, cash out, free play used, hands played (optional), notes. Shows coin-in, points earned,
  net result, cost per point and hands per hour.

## C3 — The numbers (pure functions, unit-tested)
- Session coin-in: points source = Δpoints × $/point; hands = hands × bet − free play (when free play earns nothing);
  estimate = active hours × your measured pace × bet, labeled "estimated".
- Points without a reading follow the program rule (carryover: running total across all sessions, in order).
- Net = cash out − cash in (free play winnings are already in cash out).
- Actual cost per point = net loss ÷ points. **Theoretical** = Σ coin-in × (1 − effective return) ÷ points, where
  effective return = the pay table's return minus your measured error cost on it (optimal if fewer than 200 practice
  decisions, labeled). "Your mistakes this trip cost $X" = Σ coin-in × error cost.
- Net cost after rewards = (net loss − reward value) ÷ points. Points, hands and coin-in per active hour.
- Changing $/point recalculates history: only raw readings are stored; everything derived is computed on read.

## C4 — Planner and luck band
- Inputs (prefilled from the trip, all what-if): target, points so far, casino hours left (planned hours of the
  remaining days, less time already played today), game, denomination, coins, hands per hour (your casino pace, else
  practice pace, else 600), effective return.
- Outputs: coin-in needed, hands, hours, points per hour, expected cost, **on track / behind**, the hands per hour or
  bet needed to finish in the hours left, and the **luck band** (10th / 50th / 90th percentile result, chance to finish
  ahead), computed in the worker. Reproduces the spec's worked example exactly (2,500 points; $1.25 and $5 per hand at
  700 hands/hr → 30,000 hands ≈ 43 h; 7,500 hands ≈ 11 h).
- Simulation: rare big pays (royal, straight flush, bonus quads) are drawn as counts; the many small outcomes are
  summed with the normal approximation, which is exact enough at thousands of hands. Short plans (≤ 2,000 hands) are
  simulated hand by hand.

## C5 — Rewards, reports, practice pace
- **Rewards ledger:** offer, type (cruise, upgrade, free play, onboard credit, discount, other), your cash value,
  date, trip. Value per point and lifetime ROI = (rewards − net loss) ÷ net loss.
- **Trip and lifetime reports:** session table and totals; CSV export of trips, sessions and rewards. Backups already
  include all of it (with a note that the file now contains financial history).
- **Practice pace:** from your Free Play decisions, gaps over 60 s count as breaks; hands per active hour and the
  points that practice would have earned at its bet.

## Out of scope this round
Casino-Pace Mode (next), charts of cumulative points vs cost, iOS Live Activity timer, other programs' presets.
