# 09 — Interface Round 2 Plan

Second round of feedback, after the polish in `08-UI-POLISH-PLAN.md` shipped. Four items: machine setup, changing
the bet during play, explaining *why* a hold is better, and the broken table analysis. Status: **awaiting approval**.

---

## R1. Machines: keep the popular machines, one way to add, deal speed at the table

**Found**
- The three starter machines (9/6 Jacks, Double Double Bonus, Deuces Wild) only appear while the floor is empty.
- Two controls add a machine: the "+ New machine" button in the page header and the "+ New machine" tile at the end
  of the floor.
- Deal speed is set per machine in the machine editor, so changing it means leaving the table.

**Plan**
- **One way to add a machine:** keep the **"+ New machine" tile** at the end of the floor and remove the header
  button. *(Question 1.)*
- **Popular machines stay available:** the tile opens the sheet on a first step, **"Start from a popular machine"**:
  - Cards for the popular machines show the game, pay table and computed return.
  - One click adds one with sensible defaults (25¢, 5 coins, 1 line). "Customize first" opens the full editor
    pre-filled.
  - A **"Build your own"** card goes straight to the full editor, including "Enter a pay table…".
  - The empty floor keeps showing the popular machines as today.
- **Popular list:** the three current starters, plus a few common floor games from the built-in library. Candidates
  are 8/5 Bonus Poker, 9/6 Bonus Poker Deluxe, 10/7 Double Bonus and "Not So Ugly Ducks" Deuces Wild. *(Question 2.)*
- **Deal speed moves to the table:** Relaxed / Normal / Fast goes into the ⚙ Table settings popover, next to
  feedback timing.
  - It becomes a **player preference** that applies to every machine and is saved with the profile, like card colors.
  - Changing it takes effect on the next deal.
  - It's removed from the machine editor.
  - The `machine.speed` field stays in the data model, ignored, so old data and backups still load.
  - *(Question 3.)*

## R2. Change the bet during play

**Found**
- A machine's coin count is part of a session's frozen terms (`machineSnapshot.coins`).
- Dealing, settling, grading, statistics and archiving all read it. So on a $1 machine set to 5 coins, every hand
  bets 5 credits ($5).
- Decisions already record the coins actually bet.

**Plan — like a real machine**
- **BET controls on the table:**
  - A bet selector next to the BET meter: **1 2 3 4 5** credits per line.
  - **Bet One** cycles 1 → 5 → 1, the way the real button does.
  - **Bet Max** sets 5 and deals.
  - Keyboard shortcuts: **B** = bet one, **M** = bet max.
- **When the bet can change:** only between hands. It's locked once cards are dealt, so a paid hand can never be
  re-priced.
- **What updates when it changes:**
  - The pay table display lights the new coin column.
  - The BET meter shows credits and dollars.
  - Everything the engine does for that hand (best hold, grading, payouts) uses the actual bet. That matters
    because strategy changes below max bet: the royal pays less per coin.
- **Data:**
  - The session gets a current bet. The machine's coin count becomes its **default bet**, labelled "Default bet" in
    the editor.
  - Dealing, settlement, the hand's analysis and the decision record all use the bet of that hand.
  - Coin-in and net already add up actual bets.
  - Statistics already report one coin count at a time. They switch from "session's coin count" to "this
    decision's coin count", so a session that mixed bets reports correctly under each coin count.
  - Archiving gets the same change.
  - Old sessions are unaffected: each has one bet.
- **Short-bet warning:** a small note when betting under max on a table whose royal pays a bonus at 5 coins, e.g.
  "Royal pays 250 per coin below max bet (4,000 at 5 coins)". It's shown once per session.
- **Rapid Drill:** gets the same bet selector, so short-bet strategy can be practiced. Drills never bet from the
  wallet.
- **Lines:** they stay fixed per machine, as on real multi-play machines. *(Question 4.)*

## R3. Why one hold beats another

**Found**
- For every one of the 32 possible holds, the engine already stores the count of each final hand across all possible
  draws, and the total number of draws.
- Each hold's expected value is exactly the sum over final hands of (chance × pay); I checked this.
- Example: from A♥ K♥ Q♥ 7♥ 7♣ (9/6 Jacks, 5 coins):

  | Hold | Draws | Royal | Flush | Straight | Trips | Two pair | Jacks+ | EV |
  |---|---|---|---|---|---|---|---|---|
  | A♥ K♥ Q♥ | 1,081 | 1 | 35 | 15 | 9 | 27 | 348 | **6.93** |
  | 7 7 | 16,215 | – | – | – | 1,854 | 2,592 | – | 4.12 (adds 45 quads, 165 full houses) |

  The single royal in 1,081 draws contributes **3.70** of the 6.93 credits. That's the "small chance of a big hand"
  story you described.
- All of this is already on the device for every dealt hand, so the breakdown needs **no engine changes** and works
  offline.

**Plan — "Why?" in the details drawer**
- **Hold comparison:** your hold and the best hold side by side, one row per final hand. Each row shows:
  - the chance, as a % and "1 in N"
  - the pay at the current bet
  - the **EV contribution** (chance × pay) for each hold
  - the difference between the two holds

  The rows that decide the outcome are highlighted (largest positive and negative differences).
- **EV composition bar:** one stacked bar per hold showing what makes up its expected value (royal, flush, straight,
  pairs…). The royal-heavy hold reads at a glance.
- **Plain summary line:** generated from the numbers, not AI. For example: "Your hold wins more often (Jacks or
  Better 32% vs 0%), but the best hold's 1-in-1,081 royal is worth 3.70 credits on its own and its flushes add 0.97.
  Net: +2.82 credits per line."
- **Explore any hold:** "Compare another hold…" shows the hand's 5 cards. Tap cards to build any hold and see its
  breakdown next to the best one. There's also a short list of the top 5 holds by EV, each one tap.
- **Layout:** stays optional. It sits inside the existing details drawer, open by default after a mistake and closed
  after an optimal hold, as you chose. On phones the comparison becomes stacked cards instead of a wide table.
- **Shared data:** the breakdown is built by one pure, unit-tested function, so the AI step below can reuse it.

**Later (AI phase) — noted in `04-ROADMAP.md`**
- When the AI hooks arrive, the coach will explain in plain English *why* one hold is better and give a way to
  remember it.
- It's **grounded in this breakdown**: the engine supplies the numbers, and the AI only writes the words. It never
  computes or changes EV.
- It should pair each explanation with a short memory aid tied to the strategy chart line or heuristic.

## R4. "Optional table analysis" fails with "Failed to fetch"

**Found**
- The panel loads a precomputed file (about 1 MB) for library pay tables.
- "Failed to fetch" is the browser's message for a network-level failure of that download. That rules out a missing
  file, which would say "HTTP 404", and a corrupt one, which would fail the integrity check.
- It works in this container in development and in a production build, so it is environment-specific. Likely causes:
  - the Replit preview proxy
  - a slow cold start
  - an older service worker on the deployed site
- The panel only shows return, variance and hit frequency, and those don't need the download at all.

**Plan**
- **Compute the panel locally for the current bet.** The engine computes the exact return, variance and hit
  frequency on the device in about 2–3 seconds. That:
  - removes the download from the panel
  - shows figures for the bet actually being played (replacing the "5-coin baseline" warning)
  - works offline for every table, built-in or custom
- **Find and fix the download failure too:** Statistics and targeted drills still use the precomputed files.
  - Reproduce on the Replit preview and the deployed site, using the details you send.
  - Add up to two retries with backoff for network errors.
  - Fall back to exact local computation, which Statistics already does, if downloads keep failing.
  - Make error messages name the file and the cause instead of a bare "Failed to fetch".
- **Test:** an end-to-end test that blocks `/analyses/` and still expects the panel and a Statistics report to work.

---

## Build order

| Step | Scope | Size |
|---|---|---|
| 1 | R4: local table analysis, retries, clearer errors, root cause | small |
| 2 | R1: popular-machine step in the sheet, single add entry, deal speed in table settings | small |
| 3 | R2: bet controls and per-hand bet through play, decisions, statistics and archiving | medium |
| 4 | R3: hold comparison, EV bars, summary line, explore-any-hold; roadmap note for AI | medium |

Each step ships with unit and end-to-end tests, updated screenshot baselines and notes in `replit.md`.

## Questions

1. **Add-machine entry:** keep only the "+ New machine" tile at the end of the floor (recommended), or only the
   header button?
2. **Popular machines:** the current three plus 8/5 Bonus, 9/6 Bonus Deluxe, 10/7 Double Bonus and NSUD Deuces, or
   just the current three?
3. **Deal speed:** one preference for all machines (recommended), or per session?
4. **Lines:** keep lines fixed per machine (recommended), or make them changeable at the table like the bet?
5. **Table analysis error:** where did you see it, the Replit preview or the deployed site? Did the machine cabinets
   show a return % (for example "99.54% return") on that same visit?
