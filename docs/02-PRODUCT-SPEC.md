# Product Spec (PRD)

## 1. Vision

A video poker coach that (1) computes perfect play for any pay table, (2) reads pay tables and hands from photos, (3) learns *your* specific mistake patterns, and (4) trains them away with focused drills and memorable heuristics. Web first, then iOS.

**Owner's primary goal:** earn cruise casino rewards (free cruises), starting with Royal Caribbean Casino Royale (Club Royale, 1 point per $15 coin-in), at the **lowest cost per point** and within the **limited casino hours** of a cruise. Accuracy lowers cost per point; speed lowers hours needed. The Rewards Tracker (F9, `07-CRUISE-REWARDS.md`) measures both.

## 2. Target Users

| Persona | Need |
|---|---|
| **Advantage Player** | Masters several games at full-pay tables; needs <0.05% error cost; scouts casinos. |
| **Serious Recreational** | Plays 1–2 games on trips; wants to stop losing to strategy errors; likes stats. |
| **Beginner** | Doesn't know strategy exists; needs simple heuristics and gentle progression. |
| **Cruise Rewards Player** (primary, the owner) | Plays to earn casino loyalty points for free cruises; wants minimum cost per point, enough speed to hit a target in the casino hours available, and honest tracking of real coin-in, losses and rewards. |

## 3. Design Principles

1. **Math is deterministic, language is AI.** EV, strategy and stats come from the engine. LLMs only *read images* and *write words*, always grounded in engine output, never trusted for math.
2. **Every number is confirmable.** Anything extracted from a photo is shown to the user for confirmation before use.
3. **Works offline** for all play and training; AI features degrade gracefully.
4. **Train what costs money.** Prioritize weaknesses by EV cost × frequency, not raw error count.
5. **Fast.** A hand decision drill should feel instant (<50 ms feedback).

## 4. Feature Requirements & Acceptance Criteria

### F1 — Strategy Engine
- **F1.1** For any supported game + pay table, return all 32 holds with exact EV (in coins at the user's bet).
  - *AC:* Results match a reference brute-force enumeration exactly (to 1e-9) on a 1,000-hand random test set per game family.
- **F1.2** Full pay table analysis: return %, variance, hit frequency, probability of each payout line.
  - *AC:* Known returns (within ±0.005%): 9/6 Jacks or Better 99.54%; 8/5 Bonus Poker 99.17%; 10/7 Double Bonus 100.17%; 9/6 Double Double Bonus 98.98%; Full-Pay Deuces Wild 100.76%. (Check the reference values against two independent sources during QA.)
  - *AC:* Library pay tables load instantly (precomputed at build time). A new pay table is analyzed on device in < 30 s with a progress bar, then cached by pay table hash.
- **F1.3** Hold-pattern labeling: every hold maps to a canonical category label (e.g. `4RF`, `4FL`, `LP`, `KQJ_unsuited`, `3SF_t2`).
- **F1.4** Strategy list generation: ordered list of categories (with penalty-card refinements) derived per pay table.
  - *AC:* Playing the generated "Expert" list over all hands reaches within 0.02% of optimal return; the actual gap is shown.
- **F1.5** Tiered strategies (Beginner / Intermediate / Expert / Perfect), each with an exact return.

### F2 — Pay Table Capture
- **F2.1** User captures or uploads a photo; the app returns a structured pay table (hand rows × coin columns 1–5), the game family guess, and per-field confidence.
- **F2.2** Validation rules flag problems (non-monotonic columns, missing rows, implausible royal, columns that aren't linear apart from the royal).
- **F2.3** Confirmation grid: editable; low-confidence cells highlighted; "match to library" suggestions.
- **F2.4** On confirm: show return %, common name, rank among variants, and "Strategy differs from base game in N lines."
  - *AC:* On a test set of 50 real pay table photos, ≥90% are fully correct with no edits; 100% are correctable in under 30 s.

### F3 — Hand Capture & Analysis
- **F3.1** Photo → 5 cards (rank, suit, position), optionally held flags, credits, and the pay table if visible.
- **F3.2** Manual entry: tap picker + text shorthand (`As Ks Qd 7c 2h`, also `T` for ten, `10` accepted).
- **F3.3** Analysis view: holds ranked by EV, EV difference from the best, category label, strategy-line citation, AI explanation (optional).
- **F3.4** "Across pay tables" toggle: show whether the best hold changes across the user's saved machines.

### F4 — Training
- **F4.1 Free Play**: WinPoker-like loop (Deal → Hold → Draw → Pay). Feedback modes: `warn_before_draw`, `show_after_draw`, `silent_report`.
- **F4.2 Rapid Drill**: decision only; tap holds + Enter; instant correct/incorrect with EV loss.
- **F4.3 Weakness Trainer**: drill hands drawn from the user's top-N weakness categories (≈70%), mixed with review (≈20%) and random hands (≈10%) to avoid overfitting.
- **F4.4 Close Calls**: hands where |EV₁ − EV₂| < threshold.
- **F4.5 Strategy Ladder**: progressive line-by-line learning.
- **F4.6 Pay Table Switcher**: same hand shown under 2–3 pay tables.
- **F4.8 Casino-Pace Mode** (MVP): train toward a target hands/hr while holding accuracy; reports the speed vs error-cost trade-off in $/point and hours saved.
- **F4.7 Spaced repetition**: FSRS scheduling of "pattern cards".
  - *AC (all):* every decision is persisted with full context (see Tech Spec `decisions` table).

### F5 — Mistake Intelligence
- **F5.1** Dashboard: accuracy %, EV lost per 1,000 hands, **effective return** vs optimal, trend over time.
- **F5.2** Confusion matrix of (correct category → chosen category), sortable by total EV cost.
- **F5.3** Weakness ranking (formula in Tech Spec §6).
- **F5.4** Context analysis: error rate vs decision time, position in session, recent pay table switch, recent outcome.
- **F5.5** AI coaching report (on demand / weekly) written from computed stats only.

### F6 — Heuristics
- **F6.1** For each of the top weaknesses, generate a heuristic card: *Rule*, *Mnemonic*, *Exceptions*, *Example hands*, *Cost if followed blindly* (engine-validated).
- **F6.2** User can edit a rule or write their own; the engine reports its cost.
- **F6.3** Export the strategy list + personal heuristics as a printable PDF (wallet card + full page).

### F7 — Machines, Wallets, Sessions
- **F7.1** CRUD machines: name, pay table, denomination, coins bet (1–5), lines (1/3/5/10), theme, deal speed.
- **F7.2** Wallets: create/rename; one wallet can serve one or more machines; ledger of every credit/debit; top-up; transfer between wallets.
- **F7.3** Sessions: start on a machine; several sessions open at once; switcher UI; each preserves its current hand, credits, stats; auto-save every action.
- **F7.4** Session summary on close: hands, coin-in, net, error rate, EV lost, biggest hits, top 3 mistakes.
  - *AC:* Switching sessions restores the exact state (including a hand mid-hold) in < 200 ms.

### F9 — Cruise Rewards Tracker (MVP, full detail in `07-CRUISE-REWARDS.md`)
- **F9.1** Rewards programs as config; built-in default: Royal Caribbean Club Royale (Casino Royale), $15 coin-in = 1 point. All rules editable.
- **F9.2** Trips (cruises) with target points and planned casino hours per day (sea vs port days).
- **F9.3** Real casino session logging: live start/pause/stop timer, cash in/out, free play, points before/after; coin-in derived from points delta, hands × bet, or time estimate.
- **F9.4** Totals per trip and lifetime: coin-in, net win/loss, points, active hours, **actual cost per point**, **theoretical cost per point** (from your measured effective return), net cost after rewards received, points/hour, hands/hour.
- **F9.5** Active play time tracking for both practice (idle detection) and real play (timer).
- **F9.6** Target planner: hours, hands and expected cost to reach a target; on-track status; what-if on game/denomination/speed; risk band.
- **F9.7** Rewards ledger: offers received with user-assigned value → value per point and ROI.
- **F9.8** Practice sessions show virtual coin-in, points and pace, to rehearse a trip.
  - *AC:* see `07-CRUISE-REWARDS.md` §7.

### F8 — AI Provider Settings
- **F8.1** Settings: user enters their own OpenAI and/or Anthropic API key (bring-your-own key only; no app-provided key). Provider per task (`vision`, `coach`, `heuristics`); model per provider. Web: "Remember key on this device" toggle (default off = session only). iOS: Keychain.
- **F8.2** "Test connection" button for each provider.
- **F8.3** Automatic fallback to the other provider if configured (optional toggle).
- **F8.4** Usage log: tokens, estimated cost, per task.
- **F8.5** With no key set, every AI feature shows a friendly "add a key" prompt; all non-AI features work fully.

## 5. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | 32-hold analysis < 150 ms in a Web Worker on a mid-range laptop; drill feedback < 50 ms using precomputed/cached answers. |
| Offline / local | Guest mode only: all data on device (IndexedDB), no account, no cloud. Play, drills and stats work fully offline (PWA). Export/import backup file. |
| Privacy | No servers receive user data. Photos and hand data go only to the AI provider the user picks, with their own key. Photos kept locally only if the user opts in. |
| Accessibility | WCAG AA; full keyboard play; screen-reader card names; four-color deck. |
| Compliance | Play money only; no purchasable coins; mature age rating on iOS for simulated gambling (check the current App Store guidelines when submitting). |

## 6. Success Metrics

- Owner's theoretical cost per point falls trip over trip, and trip point targets are reached within planned casino hours.
- Users' effective return gap (optimal − actual) shrinks by ≥50% after 2 weeks of Weakness Trainer.
- Photo pay table extraction: ≥90% fully correct with no edits.
- D7 retention ≥ 35% among users who complete one drill.

## 7. Decisions (made)

| Topic | Decision |
|---|---|
| AI keys | **Bring your own key only** (OpenAI and/or Anthropic). No app-provided key. |
| Accounts | **Local guest mode only** for now: no login, no backend, data on device + manual backup. Accounts and sync come later; data schemas are written to be sync-ready. |
| Monetization | Not a concern for now. |
| Launch games | Jacks or Better, Bonus Poker, Bonus Poker Deluxe, Double Bonus, Double Double Bonus, Deuces Wild (full-pay & NSUD). |
| Multiplier games | Later. Engine and data hooks are built in now (Tech Spec §3.9, `06-MULTIPLIER-GAMES.md`). |
| iOS | Capacitor wrapper of the web app. |
| Rewards | Cruise rewards tracking is MVP. Launch program: Royal Caribbean Club Royale (Casino Royale), $15 coin-in per point. |

### Still open (later)
- When to add accounts/cloud sync, and with which auth provider.
- Order of the next game families (Joker Poker, Triple Double Bonus, Aces & Faces, …).
