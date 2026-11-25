# Hand Analyzer — plan

Spec: F3.2–F3.4 in `02-PRODUCT-SPEC.md` (Prompt 10 in `05-REPLIT-AGENT-PROMPTS.md`). Photo entry (F3.1) waits for the
photo round, and the AI explanation waits for the AI provider round; this round leaves a place for both.
Status: **built** (see replit.md "Hand Analyzer").

Goal: enter any five cards — a hand from the casino, a hand you're unsure about — pick the game and bet, and see every
hold ranked with exactly what it is worth and why, using the same engine numbers as play.

## A1 — Where it lives
- New **Analyze** page in the main navigation (between Session room and Statistics), route `#/analyze`.
- The page address carries the hand, table and bet (e.g. `#/analyze?hand=AsKsQd7c2h&table=…&bet=5`), so an analysis can
  be reopened, bookmarked, or opened from elsewhere in the app.
- **"Open in analyzer"** link in the details drawer after a hand (Free Play and Rapid Drill), and on mistakes in
  Statistics where a hand is shown: opens that exact hand, table and bet.

## A2 — Entering a hand
- **Card picker:** a 4 × 13 grid (one row per suit, colored like the deck setting). Tap to fill the five slots in order;
  tap a slot to clear it; cards already used are disabled. Works by keyboard (arrow keys + Enter).
- **Type it:** a text field accepting `As Ks Qd 7c 2h`, `AsKsQd7c2h`, `T` or `10`, any case, commas allowed. Invalid
  input says what is wrong ("Two cards are the 7 of clubs", "‘Zx’ is not a card").
- **Random hand** and **Clear** buttons.
- Order matters only for display; the analysis is the same in any order.

## A3 — Game, pay table and bet
- **Pay table** picker: your machines first ("Quarter Jacks — 9/6 Jacks or Better"), then built-in and custom tables,
  grouped by game. Defaults to the open session's table, else your most recently played machine, else 9/6 Jacks.
- **Bet** chips 1–5 (default the machine's bet). Below max bet the note about the reduced royal appears, as at the table.
- Values show in credits per line; with a machine chosen they also show dollars at its denomination.

## A4 — Results: every hold ranked
- The five cards large, with the best hold raised.
- A ranked list of all 32 holds: held cards (mini cards), its name (e.g. "4 to a Royal Flush"), expected value,
  and difference from the best. Ties with the best are marked "Also best". Top 8 shown; "Show all 32 holds" expands.
- Close calls are called out: "The top two holds are within 0.05 credits."
- Selecting any row opens the **Why?** comparison against the best hold (the same panel as after a mistake: summary
  sentence, value bars, per-hand chances table). The panel is refactored to take an analysis and two holds, so play and
  the analyzer share it.

## A5 — "What I held" (optional)
- A toggle on the five cards: tap the cards you actually kept. The analyzer then shows the cost of that hold and opens the
  Why? comparison for it — for reviewing a hand from a real casino.

## A6 — Strategy-line citation
- For the best hold: which line of the strategy chart picks it, e.g. "Expert chart · line 7 of 31: 4 to a Flush".
  If the chart would pick a different hold than the best (a deliberate simplification), it says so and shows the cost.
- Charts exist for max bet only; at other bets this reads "Strategy charts are for max bet."
- Built-in tables: the chart comes with the analysis file (downloaded once, kept offline). Custom tables: computed the
  first time on request (about 15–20 s), then saved.

## A7 — Across pay tables (F3.4)
- "Does this hold change on other machines?" — a table of each of your machines (at its bet): its best hold, and whether it
  differs from the selected table's. Rows that differ are highlighted, with what the selected table's hold would cost
  there.
- Each row is computed on the device in milliseconds; nothing downloads.

## A8 — Out of scope (later rounds), with a slot left in the UI
- Photo entry (F3.1): a disabled "From a photo" entry point is **not** shown until it works.
- AI explanation: the Why? panel already has the summary sentence the AI will expand; the "Explain" button arrives with
  the AI provider round.

## Testing
- Unit: hand-text parsing (all accepted forms and each error), the address encode/decode, the ranked list (32 rows, ties,
  close-call threshold), the across-tables comparison, and the strategy citation (agrees with `selectStrategyHold`).
- e2e: type a hand → ranked holds and Why?; picker entry by mouse and keyboard; "What I held"; switching table and bet
  changes the answer (e.g. a hand whose best hold differs between 9/6 Jacks and Double Double Bonus); "Open in analyzer"
  from a played hand; reload keeps the hand (address).
- Visual: analyzer desktop and phone shots added to the tour.

## Decisions (confirmed)
1. Strategy citation: the **Expert** chart by default, with a switch for Beginner and Intermediate.
2. Across pay tables: **your machines plus the seven popular tables**.
3. **Recent hands:** yes — the last 20 analyzed hands, kept locally (in the profile, so backups include them).
4. Phone picker: **rank row, then suit row** on small screens; the full 4 × 13 grid on larger ones.

## Questions
1. **Chart tier for the citation:** cite the **Expert** chart by default with a switch for Beginner / Intermediate, or
   always cite one tier?
2. **Across pay tables:** your machines only (as the spec says), or also the seven popular tables?
3. **Recent hands:** keep a short local list of recently analyzed hands (say the last 20) on the Analyze page?
4. **Phone layout:** the 52-card picker is tight on a phone. OK to show it as a rank row + suit row (tap rank, then suit)
   on small screens, with the full grid on larger ones?
