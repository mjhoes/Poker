# Feature Brainstorm — Video Poker Trainer

Working name: **"Perfect Draw"** (placeholder)

The goal is the best video poker training app available: it plays perfect strategy for *any* pay table, reads pay tables and hands from photos, finds the specific patterns behind your mistakes, and trains you on exactly those patterns until they stop happening.

Legend: ⭐ = core differentiator, 🟢 = MVP, 🟡 = v1.x, 🔵 = later / stretch

---

## 1. The Engine (everything depends on this)

| Feature | Tier | Notes |
|---|---|---|
| Exact EV of all 32 hold options for any hand, any pay table | 🟢⭐ | Deterministic math, never an LLM. |
| Full-game analysis: return %, variance, hit frequency, and how often each hand occurs | 🟢⭐ | Runs over all 134,459 suit-distinct starting hands; cached per pay table. |
| Support for 52-card games, Deuces Wild, Joker Poker (53 cards), wild-card variants | 🟢 Jacks/Bonus/DB/DDB/Deuces · 🟡 Joker, TDB, Aces & Faces, etc. | Game "families" are defined by data, not code. |
| Multi-play (Triple/Five/Ten/Fifty Play) | 🟡 | Same optimal strategy as single-line; variance differs. |
| Ultimate X, Super Times Pay, Dream Card, Multi-Strike | 🔵 | Hooks built in from day one (value-vector solver, variant state); see `06-MULTIPLIER-GAMES.md`. |
| Strategy-list generation from the math (derived ordered hold list, not copied from published charts) | 🟢⭐ | Base for heuristics and focused drills. |
| Tiered strategies (Beginner → Perfect) with the **cost of each simplification** in % return | 🟡⭐ | "Simple strategy costs you 0.08%." |
| Rule-of-thumb validation: test any heuristic against every hand and report its cost | 🟡⭐ | "Your rule 'always hold 4-flush over low pair' costs 0.02% on this pay table." |

## 2. Pay Table Capture & Analysis

| Feature | Tier | Notes |
|---|---|---|
| 📸 **Photo → pay table**: snap a machine's pay table glass or screen and get a structured table | 🟢⭐ | Vision LLM pulls out the table, rule-based validation checks it, user confirms in an editable grid. |
| Auto-identify game family + common name ("9/6 Jacks", "NSUD", "10/7 DB") | 🟢 | Compared against the built-in library by row match. |
| Instant verdict: return %, rank vs other versions of that game, "play / skip" | 🟢⭐ | Casino scouting mode. |
| Includes slot club cashback, promos and multipliers in the effective return | 🟡 | "99.54% + 0.25% cashback = 99.79%." |
| Side-by-side pay table comparison & "what changed in the strategy" diff | 🟡⭐ | e.g. "8/5 vs 9/6 Jacks: these 6 strategy lines change." |
| Manual pay table editor + preset library of ~100 common tables | 🟢 | Fallback when there's no photo. |
| Scouting log: save scanned machines with casino, location, denomination, date | 🟡 | Personal pay table database. |
| Multi-denomination & coin-in awareness (short-coining effect on the royal) | 🟡 | Shows the return at 1–4 coins vs max coin. |

## 3. Hand Capture & Analysis

| Feature | Tier | Notes |
|---|---|---|
| 📸 **Photo → hand**: photograph a machine screen (or real cards) → 5 cards detected | 🟢⭐ | Card pickers to confirm or correct; also reads which cards are held if visible. |
| Manual quick-entry (tap rank/suit, or type "AsKsQd7c2h") | 🟢 | |
| All 32 holds ranked by EV, showing EV gap to the best | 🟢 | |
| "Why" explanation: strategy-line citation + plain-English coaching | 🟢⭐ | LLM writes the wording from engine facts. |
| Ask follow-up questions ("Why not keep the Ace?") | 🟡 | LLM chat grounded on the engine's output. |
| Show how the decision changes across pay tables ("This is a 9/6-only play") | 🟡⭐ | |
| Hand history import from photo series of a real session | 🔵 | |

## 4. Training Modes

| Mode | Tier | Description |
|---|---|---|
| **Free Play** (WinPoker-style) | 🟢 | Realistic machine UI. Options: warn before a mistake / show after / silent with report at the end. |
| **Rapid Decision Drill** | 🟢 | No animation: hand appears, you pick a hold, instant feedback. Built for volume. |
| ⭐ **Weakness Trainer** (adaptive) | 🟢⭐ | Deals hands chosen to target your weakest decision patterns (see §5). |
| ⭐ **Close Calls / Expert Drills** | 🟡 | Only hands where the top two holds are within a tiny EV gap. |
| **Strategy Ladder** | 🟡 | Learn the strategy list top-down, one line at a time, then mixed review. |
| **Penalty Card Trainer** | 🟡 | Hands where a penalty card flips the decision. |
| **Pay Table Switcher Drill** | 🟡⭐ | Same hand, different pay tables: learn which plays change. |
| ⭐ **Speed / Casino-Pace Mode** | 🟢⭐ | Train to a target hands/hr while holding accuracy; shows the $/point cost of speed errors vs hours saved. |
| **Flashcards with spaced repetition** | 🟡 | Card = canonical hand pattern; scheduled by FSRS. |
| **Daily Workout** | 🟡 | 10-minute mix of review, weaknesses and new material, with streaks. |
| **Exam / Certification** | 🔵 | 500 hands, aim for ≥99.9% of optimal EV. Badge per game. |

## 5. Mistake Intelligence (core differentiator)

| Feature | Tier | Notes |
|---|---|---|
| Every decision logged with the EV of your hold vs the best hold | 🟢 | |
| Each decision labeled with its **strategy category** (e.g. "4-Flush vs Low Pair") | 🟢⭐ | Labels come from the engine's hold-pattern vocabulary. |
| **Confusion matrix**: "When the correct play is X, you choose Y n% of the time" | 🟢⭐ | |
| Weakness score = frequency × EV cost × recency × how often the hand occurs in real play | 🟢⭐ | Ranks what is actually costing you money. |
| **Your effective return**: "You're playing this 99.54% game at 99.21%" | 🟢⭐ | The headline number. |
| Mastery model per category (Bayesian), with decay over time | 🟡 | Moves a category in and out of the focus queue. |
| Spots patterns in *when* mistakes happen: speed, fatigue late in a session, right after a pay table switch, after big wins or losses | 🟡⭐ | |
| Weekly coaching report (LLM-written, from computed stats) | 🟡 | |
| Interference detection: "Your Deuces Wild training is hurting your Jacks play" | 🔵⭐ | Cross-game confusion. |

## 6. Heuristics & Memorization

| Feature | Tier | Notes |
|---|---|---|
| Auto-derived **strategy list** per pay table | 🟢⭐ | |
| **Personal heuristic cards** generated for your weak spots: a short rule, a mnemonic and its exceptions | 🟢⭐ | LLM writes the words; the engine checks the rule against every hand and reports its cost. |
| Pattern families with visuals ("the 3-to-a-straight-flush ladder") | 🟡 | |
| Printable/wallet strategy cards (PDF), tiered | 🟡 | Wallet-sized strategy cards are generally allowed in casinos; the app should say "check house rules". |
| "Rule of thumb lab": write your own rule and see its exact cost | 🟡⭐ | |
| Mnemonic styles: acronym, story, rhyme, visual cue; user picks a favorite | 🟡 | |
| Heuristic deck that adapts as weaknesses are fixed | 🟡 | Rules retire once mastered. |

## 7. Machines, Sessions & Wallets

| Feature | Tier | Notes |
|---|---|---|
| **Machines**: named configs (pay table + denomination + coins + lines + speed + skin) | 🟢⭐ | "Bellagio 9/6 JoB $1", "Home NSUD quarters". |
| **Wallets**: separate bankroll per machine or shared, with ledger, top-ups and transfers | 🟢⭐ | Play money only. |
| **Sessions**: start, pause and resume; several sessions open; switch in one tap and keep state | 🟢⭐ | A tab bar or "machine carousel" across the top. |
| Session stats: hands, coin-in, win/loss, error rate, EV lost, biggest hits | 🟢 | |
| Bankroll simulator: risk of ruin, session distributions, time-to-royal | 🟡 | |
| ⭐ **Cruise Rewards Tracker**: trips, real casino sessions, coin-in, loss, points, cost per point, rewards received | 🟢⭐ | Owner's primary goal. Launch: Royal Caribbean Club Royale, $15 = 1 pt. See `07-CRUISE-REWARDS.md`. |
| ⭐ **Active play time & pace planner**: hours/hands needed to hit a points target | 🟢⭐ | Casino hours on a cruise are limited. |
| Other cruise/land programs (Celebrity, Carnival, NCL, MSC…) | 🔵 | Config only. |
| Export / import backup file | 🟢 | Guest mode keeps everything on device. |
| Accounts + cloud sync across web & iOS | 🔵 | Later; schemas are sync-ready. |

## 8. AI Provider Flexibility

| Feature | Tier | Notes |
|---|---|---|
| Choose **OpenAI or Anthropic Claude** per task (vision, coaching, heuristics) | 🟢⭐ | One provider adapter interface. |
| Bring-your-own API key | 🟢 | Key stays on device (web storage opt-in, iOS Keychain); calls go straight to the provider. |
| Model picker per provider, with defaults | 🟢 | |
| Fallback: if one provider fails, retry with the other | 🟡 | |
| Usage and cost meter | 🟡 | |
| Fully offline mode: all math works with no LLM; only photos and coaching text need one | 🟢 | Non-negotiable design principle. |

## 9. UX / Polish Ideas

- Machine-authentic look (CRT glow, classic button bank) *and* a clean modern "study" look.
- Keyboard shortcuts on web: `1–5` hold, `Space`/`Enter` deal/draw, `D` speed toggle.
- Haptics on iOS for the hold toggle; sound pack optional.
- Color-blind-safe four-color deck option.
- "Ghost hold" overlay: shows the optimal hold faintly (training wheels; can fade out over time).
- Streaks, XP and per-game mastery rings (light gamification that rewards accuracy, never volume of wagering).

## 10. Out of Scope (deliberately)

- Real-money gambling of any kind.
- Purchasable in-app "coins" (avoids App Store and regulatory problems; wallets are free play money).
- Copying third-party strategy charts verbatim: strategies are derived by our own engine.
