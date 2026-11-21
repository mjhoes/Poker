# Cruise Casino Rewards Tracker

**Why this exists:** the owner's main goal is to earn cruise casino rewards (free cruises) at the lowest possible cost. Playing better lowers the cost of each reward point; playing faster lowers the time needed to reach a target. This module tracks both and links them to training.

**Launch program:** Royal Caribbean's Casino Royale (loyalty program: Club Royale), **1 point per $15 of coin-in**. Programs are data, so others (Celebrity Blue Chip, Carnival Players Club, NCL Casinos at Sea, MSC…) can be added later as config without code changes.

> All program rules (earn rate, tier thresholds, rounding, whether free play earns points) are **user-editable config**. Defaults come from what the owner provided; anything else is marked "verify". Casino programs change their rules without notice.

---

## 1. Concepts

| Concept | Description |
|---|---|
| **Rewards Program** | Earn rule (`dollarsPerPoint = 15`), point rounding rule, whether free play earns points, optional tiers (name + point threshold, user-entered). |
| **Trip** (cruise) | Ship, sail dates, sea days vs port days, program, **target points**, planned casino hours per day, notes, offers received. |
| **Casino Session** (real play) | A stretch of real play on one machine during a trip: game/pay table, denomination, coins/hand, cash in, cash out, free play used, points before/after (optional), active time. |
| **Practice Session** (existing) | App play; also shows the points it *would* have earned and its pace, to rehearse the economics. |
| **Reward Received** | Offer/comp: description, type (free cruise, cabin upgrade, free play, onboard credit, discount), **cash value** the user assigns, trip it came from. |

## 2. What gets tracked

### Per casino session
- **Coin-in** ($), from any of three sources (whichever the user has):
  1. **Points delta** (best): points after − points before, × $15. Points can be read from the casino card/kiosk/app. Exact to within one point of coin-in ($15).
  2. **Hands × bet**: hand count (if known) × denomination × coins.
  3. **Estimate**: active time × the user's measured hands/hr × bet, marked "estimated".
- **Net result** = cash out − cash in (free play shown separately: free play won counts as a gain; free play itself is not the user's money).
- **Points earned** = per program rounding rule (default: accrue fractional coin-in across the trip, `floor(totalCoinIn / 15)`; per-session floor as an option; verify which the casino uses).
- **Active play time** (see §4).
- Game, pay table (from library or photo scan), denomination, coins, lines.
- Optional: jackpots/hand-pays (W-2G events ≥ $1,200, which also interrupt play time), notes.

### Rolled up per trip and lifetime
- Total coin-in, net win/loss, points earned, active hours.
- **Actual cost per point** = net loss ÷ points earned.
- **Theoretical cost per point** = Σ (coin-in × (1 − effective return)) ÷ points (see §3).
- **Net cost per point after rewards** = (net loss − value of rewards received) ÷ points.
- **Points per active hour**, **hands per active hour**, **coin-in per hour**.
- Progress to target points; time remaining at current pace.

## 3. The economics (shown in-app as "Cost of a point")

For video poker with 1 point per $15 coin-in:

```
theoretical cost per point = $15 × (1 − effective return)
```

The **effective return** is the game's optimal return minus the user's strategy-error cost, which the Mistake Intelligence module already measures (Tech Spec §6). That links training directly to the goal:

| Game & play | Effective return | Cost per point | Cost of 2,500 points |
|---|---|---|---|
| 9/6 Jacks, perfect play | 99.54% | $0.069 | ~$173 |
| 9/6 Jacks, with 0.35% of errors | 99.19% | $0.122 | ~$304 |
| 8/5 Bonus Poker, perfect | 99.17% | $0.125 | ~$311 |
| A typical 96% slot | 96% | $0.60 | ~$1,500 |

(Illustrative; the app computes these from the real pay table and your real error rate. The 2,500 figure is just an example target.)

Key facts the app should teach:
- **Denomination doesn't change the cost per point; it changes time and risk.** Coin-in needed = target × $15, regardless of denomination. A bigger bet reaches it in fewer hands but with bigger swings.
- **Every 0.1% of strategy error = $0.015 per point.** The app shows "Your mistakes this trip cost $X in extra point cost" from logged decisions on that pay table.
- **Short-term results are mostly luck.** Show the expected loss *and* a range: SD of trip result ≈ bet × √(variance × hands), with the variance per unit bet from the engine's game analysis. Example for 37,500 coin-in on 9/6 Jacks: expected loss ≈ $173 at perfect play; at $1.25/hand the ±1 SD band is roughly ±$950; at $5/hand roughly ±$1,900. Royals make the distribution skewed, so show percentiles from a quick simulation rather than only ±SD.
- Cost-per-point tracking should therefore show **theoretical** (what to optimize, controlled by skill) next to **actual** (what happened, dominated by luck).

## 4. Active play time

Time matters: casino hours on a cruise are limited (casinos usually close in port), so pace decides whether a target is reachable.

### Measuring it
- **Practice sessions (in-app):** active time = sum of gaps between actions, where any gap > *idle threshold* (default 60 s, configurable) counts as a pause. Gives exact hands/hr for the user's own play.
- **Real casino sessions:** a big **Start / Pause / Stop** timer, built from timestamps (not a ticking counter) so it survives app closure and phone lock. Pauses are tagged (drink, break, hand-pay wait, machine fault). iOS later: Live Activity / Lock Screen timer.
- **Hands/hr in casino**: derived when coin-in comes from points delta: hands = coin-in ÷ bet, divided by active hours. This calibrates real pace vs practice pace.

### Pace and target planner
Inputs: target points, days left, casino hours per day available (sea days vs port days), chosen game/denomination/coins, the user's measured hands/hr, effective return.

```
coin-in needed      = (target − points so far) × $15
hands needed        = coin-in needed ÷ bet per hand
hours needed        = hands needed ÷ hands per hour
points per hour     = hands per hour × bet per hand ÷ 15
expected cost       = coin-in needed × (1 − effective return)
```

Example: 2,500 points = $37,500 coin-in.
- Quarters, 5 coins ($1.25/hand) at 700 hands/hr → 30,000 hands → **~43 hours**.
- $1, 5 coins ($5/hand) at 700 hands/hr → 7,500 hands → **~11 hours**.
- Same expected cost either way; very different time and swings.

Planner output: "On track / behind" status, required hands/hr or bet size to hit the target in the remaining casino hours, expected cost, and a risk band (e.g. 10th–90th percentile result). Plus a what-if slider for denomination, game and speed.

### Speed training link
- The existing **Speed / Casino-Pace Mode** becomes core: train toward a target hands/hr *while holding* accuracy (e.g. ≥ 99.9% of optimal EV).
- Show the trade-off: "At 900 hands/hr your error cost rises to 0.25%, adding $0.03/point but saving 6 hours on this trip." The app finds the user's best pace for a given goal and time budget.

## 5. Screens

1. **Trip dashboard:** target ring (points / target), hours used vs available, actual and theoretical cost per point, net result, pace status, "start casino session" button.
2. **Casino session (live):** large timer with pause reasons, machine picker (or scan pay table), quick fields: cash in, cash out, points now. Minimal taps, works offline, usable one-handed in a dim casino.
3. **Session close:** enter final points/cash; app shows coin-in, points, cost per point, hands/hr.
4. **Planner:** what-if inputs and outputs from §4.
5. **Rewards ledger:** offers received with values; value per point; lifetime ROI = (rewards value − net loss) ÷ net loss.
6. **Lifetime/Trip reports:** tables + charts (cumulative points vs cost, pace over time), CSV export.

## 6. Data model additions (Dexie, sync-ready like the rest)

```
rewardsPrograms(id, name /* "Royal Caribbean Club Royale" */, casinoName /* "Casino Royale" */,
                dollarsPerPoint /* 15 */, rounding[trip_floor|session_floor|fractional],
                freePlayEarnsPoints:boolean /* verify */, tiers:[{name, points}] /* user-entered */,
                notes, isBuiltIn)
trips(id, programId, shipName, sailStart, sailEnd, days:[{date, type[sea|port], casinoHoursPlanned}],
      targetPoints, startingPoints?, notes, status[planned|active|done])
casinoSessions(id, tripId, machineId?, paytableId?, familyId?, denominationCents, coins, lines,
               startedAt, endedAt, timeSegments:[{start, end?, pauseReason?}], activeMs,
               cashInCents, cashOutCents, freePlayUsedCents, freePlayWonCents,
               pointsBefore?, pointsAfter?, handsCount?, coinInCents, coinInSource[points|hands|estimate],
               jackpots:[{amountCents, handRank?, at}], notes)
rewardsReceived(id, tripId?, programId, description, type[cruise|upgrade|freeplay|obc|discount|other],
                valueCents, receivedAt, notes)
```
Practice `sessions` gain derived fields: `activeMs`, `handsPerHour`, `virtualCoinInCents`, `virtualPoints`.

Services: `rewardsService` (programs CRUD), `tripService` (CRUD, rollups, planner), `casinoSessionService` (timer actions, close, coin-in derivation), `rewardsLedgerService`, `riskService` (simulated result percentiles from engine game analysis, run in the worker).

## 7. Acceptance criteria

- Entering points before/after derives coin-in = Δpoints × $15 and shows it as "from points".
- Timer state survives page reload/app kill; active time excludes all pause segments.
- Theoretical cost per point uses the pay table's optimal return minus the user's measured error cost for that pay table (falls back to optimal if < 200 logged decisions, labeled as such).
- Planner reproduces the §4 worked example (2,500 pts, $1.25 and $5/hand at 700 hands/hr) exactly.
- Changing `dollarsPerPoint` in program config recalculates all historical points and costs.
- All of it works offline; export includes trips, sessions and rewards.

## 8. Out of scope / notes
- No connection to casino systems; all data is user-entered or derived.
- The app doesn't advise on whether to gamble; it reports costs and risk honestly, including the luck band.
- Real-money logs are personal records; include them in backups and warn that the backup file contains financial history.
