# Perfect Draw on Replit

## Run locally

- Start the web app with `pnpm dev`.
- Build the static site, including all precomputed analyses, with `pnpm build`.
- Run engine and precomputed-asset tests with `pnpm test`.
- Run engine, assets, client, and build-script type checks with `pnpm typecheck`.
- Generate/refresh analysis assets for development with `pnpm precompute`.
- Verify generated assets and their hashes with `pnpm precompute:check`.

The web app is served by Vite on port 5000. The Replit development workflow runs
the web client; production publishing uses a Static Deployment from
`apps/web/dist`.

## Analysis assets

The source library has eight pay tables. `pnpm precompute` deterministically
generates gzip-compressed training indices in `packages/precomputed/assets/` and
copies them to `apps/web/public/analyses/`. Vite includes those files in the
static production build. Development serves them at `/analyses/` after
generation. Large reproducible outputs are excluded from Git and publishing
source uploads; the production build regenerates them.

`@perfect-draw/precomputed` exports a small manifest loader and a lazy single-table
loader. It verifies engine version, schema, and SHA-256 integrity before returning
an index. These static assets contain no user data and require no backend.
Analyses are lazy-loaded and cached in IndexedDB by the engine worker.

Versioned analysis payloads include hold categories, three memorization tiers,
an internal Reference policy (the former detailed Expert), and Perfect.
Beginner uses ≤15 printed lines (20 for Deuces) of ordered level-0 rules, not coarse buckets;
Expert uses ≤60 lines (75 for Deuces) and ≤15 penalty refinements/exceptions. Every chart's
return is measured by replaying that chart, never by perfect play. Only Perfect
selects the engine optimum directly. Generation returns measured misses with
`meetsTarget: false`; only precompute enforces library build targets: Expert
gap ≤0.03 pp for every table; Beginner ≤0.15 pp for JoB/Bonus/BPD and ≤0.35 pp
for Double Bonus/DDB/Deuces, plus Reference validation for all tables.
Reference is not a chart to memorize. Engine and precomputed-library
tests store reviewable snapshots including actual gaps for every library table.

Engine EVs use total returned coins. Full-game analysis explicitly divides by
`betCoins`; its variance is single-line variance per unit bet. Canonical-index
hold masks must be remapped to the user's original card order before use.

## Project constraints

- Keep the MVP client-only: no backend server, database server, or login.
- Persist user data locally in IndexedDB through Dexie.
- Make AI calls directly from the client with the user's own provider key.
- Keep all expected-value and strategy calculations deterministic in
  `packages/engine`; never delegate math to an LLM.

## Local app foundation (Prompt 5)

- Shared Zod contracts and all local record schemas are in `packages/shared`.
  Entity IDs are UUIDv7; the spec's natural keys (`local`, paytable hashes,
  analysis hashes, and AI provider names) remain natural keys.
- Dexie owns all persistent user data. Zustand subscribes to Dexie changes;
  it is not a second persistence layer. No localStorage, backend, or login.
- Wallet ledger writes and shared-session credit updates are one transaction.
  Ledger entries are append-only. Transfers have two matching entries.
- Session terms are snapshots: machine edits never change an open session.
  Opening/switching/pausing sessions does not spend credits. Legacy `saveHand`
  previews are unfinanced; that action cannot overwrite a real dealt round.
- JSON backups exclude API keys and regenerable analysis caches. Restore is
  explicitly replace-only, validates records/references/ledger balances before
  writing, and atomically replaces the dataset. The UI requires confirmation
  and explains that remembered keys are erased. Do not merge financial ledgers.
- `pnpm test` includes shared and local-service tests. `pnpm test:e2e` exercises
  the running dev app; after `pnpm build`, `pnpm test:offline` starts a temporary
  production preview and verifies PWA reload and worker-cache use offline.
  Browser tests use system Chromium when available (provided by Nix here).
- Cached library analyses work offline after first use. Unopened tables need
  one online load. Persistence permission is best-effort, not a backup.
- AI settings/key entry were built in Prompt 8; cruise workflows (Prompt 7b) are in "Cruise rewards tracker" below.

## Free Play and Rapid Drill (Prompt 6)

- Pure dealing, hold grading and payout resolution are exported from
  `packages/engine`. Worker preparation caches all 32 hold EVs for the actual
  configured coins, so submitting a drill does not wait for another analysis.
- Free Play supports 1–5 coins and 1/3/5/10 independent draw lines. Its saved
  hand, draw orders, holds, feedback mode, warnings and settlements survive
  reloads and backups. Rapid Drill has no wallet wager or payout.
- The play service atomically commits bets, payouts, decisions and session
  state through Dexie. Round identity guards repeat/stale actions. A paid
  unfinished hand may be paused but must be completed before session close.
- All decision-table fields are recorded, including original-order masks,
  engine EVs/categories, configured-bet analysis key, timing and prior outcome.
  Extra round/attempt metadata identifies corrections. Decision queries default
  to primary attempts; explicitly request corrections when reviewing them.
- Feedback modes are warn-before-draw, show-after-draw and silent-until-report.
  Closed reports show hands, coin-in, net, errors/rate, EV loss, largest hit and
  the top three mistakes. Cards and controls support 1–5 and Space/Enter without
  stealing form input or Ctrl+1–9 session switching.
- `pnpm test:e2e` includes ten-hand multi-line play, keyboard use, corrections,
  full decision audits and mobile drill feedback timing. `pnpm test:offline`
  also reloads a pending production hand and completes it while offline.

## Statistics and mistake intelligence (Prompt 7)

- The Statistics screen filters by exact paytable, coin count, local date range
  and play mode. It shows accuracy, EV loss per 1,000 primary decisions, return
  estimates, daily trends, sortable confusion pairs and category weaknesses.
- All statistical/EV calculations are pure engine functions. Estimates use a
  14-day half-life, Beta(1,1) posterior error and confidence factor
  `n_eff / (n_eff + 20)`. Counts/accuracy/raw EV totals and daily trends remain
  unweighted. EV units are configured-bet coins per line, not wallet profit.
- Corrections remain reviewable but never inflate primary decision counts.
  Canonical optimal categories partition real-play frequencies with suit
  multiplicities; the original logged categories are not rewritten.
- Returns never mix coin counts or tables. The original full-coverage return
  remains unknown until complete category coverage. A separate labeled ESTIMATE
  appears at the named 99%-frequency threshold, imputing unseen frequencies with
  pooled recency-weighted observed loss per decision and displaying the filled
  share. The covered-cost ceiling remains optimistic and is not a confidence bound.
- Library baselines reuse verified analyses. Short-coin baselines are computed
  exactly in the worker without inducing new charts, and work offline.
- "Train this" uses an existing matching machine and saves a category-focused,
  no-wager Rapid Drill. Focus survives reloads/backups and applies to every deal.
  This is not the future adaptive/FSRS training mix from Prompt 11.
- IndexedDB version 2 adds decision lookup indexes without deleting data.
  New session fields have defaults for older backups. Browser tests cover
  populated/empty reports, sorting, date/mode/coin filters, targeted training,
  worker failures, responsive layouts and offline report/training recovery.

## Cleanup after Prompts 5–7

- Trend buckets and date filters use the UI's explicit IANA timezone, including
  23/25-hour DST days. Chart coordinates represent local calendar dates.
- Confusion rows default to genuine mistakes. The zero-loss/equivalent-hold
  toggle shows correct alternatives without counting label differences as errors.
- Session credits are whole credits plus a separate exact-cent dollar remainder.
  Wallets, bets, payouts and affordability checks still use integer cents.
  Version 3 migrates existing display values; restore normalizes legacy backups.
- Session details show wallet names or "Deleted wallet". Enter/Space cannot
  confirm a visible hold-review warning, even when its action button is focused.
  Click an action explicitly, or change the hold to clear the warning.
- On startup, a background worker rolls raw decisions older than 90 days into
  dailyAggregates. Aggregate writes and raw deletion share one transaction;
  failures retain raw data and surface a nonblocking message. Raw card-level
  history older than 90 days is removed after its statistics are preserved.
- Aggregates retain local day/timezone, paytable, coins, variant, mode, analysis
  key, canonical optimal/chosen labels, primary/error/loss totals, correction
  counts and recency-weight inputs anchored to the named date. The half-life
  remains 14 days. Reports read raw/archived history in one consistent snapshot.
- Archived buckets retain their original calendar timezone. Exact partial-day
  filters cutting through a bucket are rejected rather than approximated.
  Pending warned rounds retain their original grade so they can still settle.
- Backups include and validate aggregates, and their decision counters include
  archived history. A gentle global backup reminder appears after about 500
  decisions since export, rather than only inside Settings.

## Interface polish (docs/08-UI-POLISH-PLAN.md)

The interface plan and its confirmed decisions live in `docs/08-UI-POLISH-PLAN.md`.
Work happens in phases; each phase keeps `pnpm build` (the Static Deployment) green.

Phase 1 (done):
- No native browser dialogs. Use `useConfirm()` from `src/components/ConfirmDialog.tsx`
  (`if (!await confirm({ title, body, confirmLabel, tone })) return;`). Danger dialogs
  focus Cancel first; restore also requires a checkbox acknowledgement.
- Notices are toasts (`toast.success/info/error` from `src/components/Toasts.tsx`).
  Success/info auto-dismiss; errors persist until dismissed; errors raised while a
  dialog is open stay inside that dialog. Don't add a notice for something the screen
  already shows.
- Felt themes are CSS tokens (`--felt-*`) selected by `data-felt` on a table/cabinet and
  `data-room-felt` on the app shell. An open session follows its machine's current felt
  (`feltFor` in `src/components/Felt.tsx`); felt is appearance, not frozen session terms.
- Cards use `--suit-red` / `--suit-black`. Final-hand cards stay full opacity.
- Copy: say "practice credits / not real money" only on the welcome card, the New wallet
  dialog and the footer. Use `familyName`, `handRankName` and `plural` from `UiHelpers`
  rather than raw ids.
- e2e: the statistics test resolves workspace source paths from the test file, so it runs
  outside `/home/runner/workspace`. Several e2e tests import `/src/...` modules into the
  page; if files were edited while `pnpm dev` was running, restart the dev server before
  `pnpm test:e2e`, or hot-reloaded module copies can make those checks fail spuriously.

Phase 2 (done):
- Styles live in `apps/web/src/styles/`, imported in cascade order from `main.tsx`:
  `tailwind` (preflight only) → `fonts` → `tokens` → `base` → `layout` → `components` →
  page files (`machines`, `wallets`, `settings`, `session`, `stats`). Use tokens from
  `tokens.css` (`--ink`, `--muted`, `--space-*`, `--radius-*`, `--felt-*`, …) rather than
  new hex values. Avoid broad descendant selectors such as `.panel span`; they restyle
  nested components (use `> span`).
- Fonts are self-hosted (`@fontsource-variable/inter`, `@fontsource-variable/bricolage-grotesque`,
  Latin subset only, declared in `styles/fonts.css`) and precached by the service worker
  (`globPatterns` includes `woff2`). Inter for UI and numbers (tabular figures are on by
  default); Bricolage Grotesque for page titles, machine names, empty states and dialogs.
- UI primitives are in `src/components/ui/`: `Button` (variants, icon, loading),
  `IconButton`, `Segmented`, `SwatchPicker`, `Disclosure`, `Badge`, `Tooltip`, `CoinAmount`.
  Icons are inline SVG in `src/components/Icons.tsx`. Prefer these over raw markup.
- Every credit amount shows its dollar value: use `<CoinAmount amount denominationCents />`
  or `formatCoins()`. Session amounts are called "credits"; sub-cent values read "<$0.01".
- `App.tsx` only composes the app. Dialogs (`src/dialogs/`) own their form and inline error
  state; actions go through `useActionRunner().run(action, { success, onError })`, which
  shares one busy flag. Other logic lives in `src/hooks/` (`useSessionActions`, `useBackup`,
  `useTableAnalysis`, `useWalletLedger`, `useRoute`).
- Screenshot regression: `pnpm test:visual` (dev server running) replays a seeded tour and
  compares against `apps/web/e2e/__screenshots__/`. Baselines depend on the browser build;
  on a new machine run `pnpm test:visual --update-snapshots` once, review the images, and
  commit them. Update baselines whenever a visual change is intended.

Phase 3 (done) — the session table:
- The table lives in `apps/web/src/table/`: `CardFace`/`CardBack` (original SVG card art, colored by
  `--suit-*` tokens, memoized), `PlayingCard` (hold toggle; keeps the accessible names tests rely on),
  `PayTable` (library pay table with the bet column lit and winning rows highlighted), `LineRows`
  (lines 2…N of multi-line play), `CreditMeter` (bet / win / credits, or drill progress),
  `Feedback` (three grade levels) and `TableSettings` (gear popover holding feedback timing).
- `winningMask()` in `table/cards.ts` decides which cards light up for a win. It is display-only and
  unit-tested; payouts always come from the engine.
- Feedback: an optimal hold shows a brief "Optimal" stamp and a small pill (details closed); a weaker
  hold shows a one-line bar with the cost and the details drawer open; warn-before-draw outlines the
  best hold on the table and swaps the Draw button for "Use best hold" / "Draw anyway". Keep the
  `h3` texts "Optimal hold", "A different hold was stronger" and "Hold review": e2e tests use them.
- Deal/draw animations: cards are keyed by hand id, position and card, so only new cards animate.
  Timing comes from the machine's speed (`data-speed` on `.play-table`); reduced motion disables it.
- Feedback-timing buttons are inside the "Table settings" popover; tests open it first.

Phase 4 (done) — the Machines floor:
- First run (no wallets) shows a welcome card: pick a starting bankroll and a "Bankroll" wallet is
  created. With a wallet but no machines, three starter machines can be added in one click.
- Each machine is a `MachineCabinet` (`src/machines/`) tinted by its felt. Its screen shows the
  computed max-bet return read from `/analyses/manifest.json` (`useLibraryReturns`); nothing is
  shown if the manifest is unavailable. The last tile is always "+ New machine".
- Play/Drill are one click (`playMachine` in `App.tsx`): continue the machine's open session in that
  mode, or start one with its default wallet. The wallet dialog (`StartSessionDialog`) opens only if
  that wallet is gone or cannot cover one bet, or from "Play with another wallet…" in the ⋯ menu.
- The ⋯ menu (`MenuButton`, WAI-ARIA menu pattern) holds Edit, Duplicate, Play with another wallet
  and Delete. Tests open it by its label "More actions for <machine name>".
- The machine editor is a sheet with a live cabinet preview. Choices are radio chips
  (`ChoiceChips`): Game, Pay table, Denomination (plus the "Denomination in dollars" field), Coins per
  hand, Lines, Table felt and Table speed. Name is optional; a blank name becomes e.g.
  "9/6 Jacks or Better · 25¢ · 3-play". The submit button reads "Add machine" / "Save changes".
- Felts: felt, midnight, classic, royal, ocean, onyx (shared schema enum; older data stays valid).
- The header shows the total bankroll across wallets and links to the Wallets page.

Phase 5 (done) — custom pay tables:
- Players enter pay tables by hand from Settings → "New pay table", or from the machine editor's
  "Enter a pay table…" (the sheet swaps to the editor and selects the saved table).
- `src/paytables/model.ts` is the pure, unit-tested core: start from a library table, shorthand
  (`9/6`, `10/7/5`, a full top-to-bottom list, deuces `200/25/15/9/5/3/2/2/1`), pasted text (one
  hand per line, 1 or 5 numbers; unknown lines are reported, never guessed), checks (errors block
  saving; warnings flag likely typos using orderings valid in every game), and `finalize()`, which
  adds the zero "nothing" row and hashes the content into the table id.
- A table's id is its content hash, so saving pays that match a built-in table uses that table, and
  saving the same pays twice returns the first copy (`paytableService.saveCustom`).
- Custom tables live in Dexie (`source: "manual"`), are loaded into the app store, and are found with
  `findPaytable()` / `useAllPaytables()` from `src/paytables/catalog.ts`. Use those instead of
  `PAY_TABLE_LIBRARY` wherever a table's name, game or pays is shown.
- The editor's live return comes from the worker's `previewGame` (max bet, about 2–3 s, not cached).
  The figures are saved on the record (`computed`), so lists and cabinets can show the return.
  The first full analysis of a custom table (for "Optional table analysis") is computed by the
  worker in about 15–20 s and then cached in `analyses`.
- A custom table cannot be deleted while a machine or an open session uses it; past sessions,
  statistics and backups keep referencing it (it is soft-deleted).

Phase 6 (done) — statistics in dollars, deck colors, charts, icons:
- Statistics accept an optional `denominationCents` filter. Reports also return `denominations`
  (in scope) and `undenominatedArchived` (archived decisions with no recorded denomination).
  The page shows dollars beside credit figures when the scope has one known denomination,
  and otherwise explains why figures stay in credits.
- Daily aggregates now record `denominationCents` (also appended to `bucketKey`). Buckets archived
  earlier have neither; they stay valid, count in totals, and are excluded from a denomination view.
  No Dexie version bump was needed (no new index).
- Deck colors are a profile preference (`prefs.deckColors`, "two" | "four"), set in Settings and
  applied with `data-deck` on the app shell; suit colors come from `--suit-*` tokens.
- Chart colors come from `--chart-*` tokens in `tokens.css` (read at render time).
- App icons: `public/icon.svg` plus PNGs (192, 512, maskable 512, apple-touch 180) listed in the
  PWA manifest. Sources are in `apps/web/assets-src/`; regenerate with
  `node scripts/render-icons.cjs` from `apps/web` (needs the Playwright Chromium).


## Interface round 2 (docs/09-UI-ROUND-2-PLAN.md)

R4 — table analysis without the full download:
- "Optional table analysis" calls the worker's `tableSummary(paytableId, coins)`. It returns, in order:
  figures saved on the pay table record (`computed` for max bet, `summaries["1".."5"]` for other bets),
  the manifest entry for a built-in table at max bet, or an exact local `analyzeGame` at that bet, which
  is then saved in `summaries` via `paytableService.saveSummary` (it re-reads the record in a transaction, so a
  rename, delete or restore made during the computation is never undone). The 10 MB per-hand analysis is no longer loaded for this panel.
- Worker downloads use `fetchWithRetry` (3 tries); if a built-in analysis file still can't be fetched,
  `loadAnalysis` computes it on the device instead.
- Shortly after a table opens, `warmOffline(paytableId)` downloads (without parsing) that built-in
  table's analysis file so the service worker keeps it for offline statistics and drills.

R1 — machines and deal speed:
- The "+ New machine" tile is the only add control. Its sheet opens on "Popular machines"
  (`STARTER_MACHINES` in `machines/machine-info.ts`, 7 entries) with "Add" (one click) and "Customize"
  per machine, plus "Build your own" (tests click `/^Build your own/` to reach the editor).
- Deal speed is a profile preference (`prefs.dealSpeed`), set in the table's settings popover and
  applied with `data-speed` on the table. The machine's old speed field is ignored by the UI.

R2 — changing the bet at the table:
- Session state has `betCoins` (bet for the next deal; null = machine default) and `handCoins` (bet of
  the hand in play). The `bet` session action changes `betCoins` and is refused while a hand is held.
  Deal charges `betCoins ?? config.coins`; draw, grading and decisions use `handCoins`. Decisions record
  their coins, so statistics keep bets apart. Use `currentBet(session)` from `table/BetControls.tsx`.
- Bet controls sit under Deal/Draw (1–5 chips, Bet Max); keys `b` cycles the bet, `m` bets max and deals.
- A focused drill (started from "Train this") keeps the machine's bet: its training key was found at that bet.
  `betForNextDeal()` in `services/bet.ts` is the one rule for the next deal's coins; the bet action refuses changes.

R3 — why one hold beats another:
- `table/hold-breakdown.ts` (pure, unit-tested) rebuilds each hold's EV from the engine's per-hold
  `rankCounts`/`rankDist` × the value vector (a "win" is a final hand paying more than zero), compares two holds row by row, picks the deciding hands,
  and writes a plain summary sentence. `table/HoldComparison.tsx` renders it inside the details drawer
  ("Why is the best hold better?"): summary, value bars, a per-hand table (stacked cards on phones),
  and "Compare another hold" (toggle cards or pick from the top five).
- The future AI coach (roadmap) should explain these same rows in words, never compute its own numbers.

## Hand Analyzer (docs/10-HAND-ANALYZER-PLAN.md)

- Route `#/analyze` (`pages/AnalyzePage.tsx`, pieces in `src/analyzer/`). The address carries the state:
  `#/analyze?hand=AsAc8d8h3c&table=<paytableId>&bet=5&held=15` (`encodeAnalyzerQuery`/`decodeAnalyzerQuery`).
  `useRoute()` now returns `search` and `replaceSearch` (updates the address without a history entry).
- Typed hands: `readHandText()` accepts `As Ks Qd 7c 2h`, `AsKs…`, `T`/`10`, suit symbols, commas; partial input is
  fine; errors name the problem. The deck picker is a 4 × 13 grid (arrow keys) on larger screens and rank-then-suit
  on phones (`analyzer/CardPicker.tsx`). Card names come from `cardName()` ("A of spades").
- Targets (`analyzer/targets.ts`): your machines (their bet and denomination, so dollars show) and every pay table.
  Defaults: the address's table, else the open session's machine, else the most recent one, else 9/6 Jacks.
  `resolveTarget()` reports `missing` when a link or recent hand names a table this device doesn't have; the page then
  shows a notice naming the table it shows instead (never a silent switch). Choosing a table clears it.
- Only valid input is analyzed: `complete` requires five cards, the parser's own `complete` flag (an unfinished
  sixth card such as `… 3c K` is not complete) and no parser error, so extra cards or a typo never produce results,
  an address or a recent hand. The analysis effect is keyed on `analysisKey` and the address effect depends on
  `complete`, so both follow validity changes even when the first five cards stay the same.
- Changing what was held (`changeHeld`) clears a hold picked from the list, so the Why? panel compares the new hold.
- Ranked holds: `rankHolds()` (ties = "best", close call when the runner-up is within 0.01 credits per coin bet).
  Selecting a hold opens the shared `HoldComparisonPanel` (the session drawer uses the same panel via `HoldComparison`).
  An analysis is shown only for exactly the current cards, table and bet (`computed.key`), never a stale one.
- Strategy chart: worker `strategyCitation(cards, paytableId, tier)` uses the engine's `strategyChoice()` (which line of
  the chart picks the hold; `selectStrategyHold` is now a wrapper). Expert by default; Beginner/Intermediate switch.
  Charts are max-bet only. Custom tables: `hasStrategyCharts()` is false until built (button, ~20 s once).
- Other tables: worker `analyzeAcross(cards, targets)` (your machines + the seven popular tables, deduplicated by table
  and bet, excluding the selected one). It uses the direct solver (`analyzeHand`, ~10 ms per table) rather than the
  fast solver, whose per-family subset tables cost ~0.5 s each and are cleared on family switches.
- Recent hands: `profile.prefs.recentHands` (last 20, newest first, the same cards/table/bet listed once), via
  `preferencesService.addRecentHand` / `clearRecentHands`. Included in backups.
- "Open in analyzer" link in the details drawer after any hand (passes the hand, table, hand's bet and what was held).

## AI coach (docs/11-AI-COACH-PLAN.md)

- Bring-your-own-key, browser-only. Code in `apps/web/src/ai/`. Both official SDKs (`@anthropic-ai/sdk` 1.14.0,
  `openai` 7.64.0) are called from the browser with `dangerouslyAllowBrowser: true` and load lazily (separate chunks,
  excluded from the PWA precache via `globIgnores`). Anthropic SDK 1.x sends the key as `Authorization: Bearer` with
  API version 2026-10-21; e2e mocks accept that.
- Models and prices: `ai/models.ts`. Tiers Light / Medium / Heavy = `claude-haiku-5-5` / `claude-sonnet-5-5` /
  `claude-opus-5-5` and `gpt-6-luna` / `gpt-6.2-sol` / `gpt-6.2-astra`. Prices are list prices (checked 2026-11-25)
  used only for estimates; update them there.
- Structured output uses Zod 4 schemas (`import * as z from "zod/v4"`; Zod 3.25 ships it) — the SDK helpers
  (`betaZodOutputFormat`, `zodTextFormat`) need v4 types. Anthropic calls use `client.beta.messages.parse` with
  `output_config.effort: "medium"` and server-side refusal fallback (`fallbacks: "default"`), except Haiku (no fallback).
- `ai/store.ts`: keys in memory by default; `rememberKeys` writes them to the `aiKeys` table (never in backups).
  `usageService` logs every call that used tokens to `aiUsage` with an estimated cost.
- `ai/router.ts` `runTask`: provider + tier → model, Zod-checked reply, one retry on a malformed reply or a failed
  `check` (with the problem in the prompt), fallback to the other provider only when enabled, its key exists and the
  failure is provider-specific (never on a bad key). `setProviderFactory` swaps in fakes for tests.
- Explain: `ai/explain-facts.ts` builds the facts from the engine's comparison and checks every number in the reply
  against them (`checkNumbers`); `ai/explain.ts` runs it, saves to `aiExplanations` (Dexie v4; not in backups) keyed by
  prompt version, provider, tier and comparison. `ExplainPanel` sits in every Why? panel (`HoldComparisonPanel` with a
  `context` prop): tier chips with estimated cost, the actual cost after, saved explanations shown free (even with no key).
- Settings → AI (`ai/AiSettingsPanel.tsx`, link `#/settings?section=ai`): keys, free Test connection (model list),
  remember toggle with the unencrypted warning, default provider and tier, fallback, and this month's usage by model.
- Production builds add a Content-Security-Policy meta tag (`vite.config.ts`): scripts from the site only; network to
  the site, `api.anthropic.com` and `api.openai.com`. Add a host there if a new provider is ever added.
- Tests never call real APIs: unit tests use fake providers; `e2e/ai.spec.ts` intercepts both APIs with `page.route`.
- Review rules (PR #4):
  - `aiService` key/settings operations run one at a time (`serial`), so a slow load can't restore a forgotten key.
  - Providers call `create` (not `parse`), record usage, then validate with `parseReply`: a paid malformed reply keeps
    its usage row and gets the router's retry. Both take an optional `fetch` for tests.
  - `costFor(returned, …, requested)`: dated IDs match their base model; an unknown returned model is priced as the
    requested one, never $0.
  - `checkNumbers` also checks number words ("ninety-nine percent"; counts 0–5 allowed as words unless a percentage)
    and rejects ratio claims ("twice", "half", "three times as"). Facts give pays as `paysAtThisBet`.
  - Saved explanations are keyed by the model that actually answered (`v1|provider|model|comparison`).
  - `ExplainPanel` tags lookups and replies with the comparison+model they were for and shows them only while that is
    still on screen.

## Photo capture (docs/12-PHOTO-CAPTURE-PLAN.md)

- Code in `apps/web/src/photo/`. **The AI only transcribes; the app interprets.** `paytable-photo.ts`: the model returns
  printed labels, five coin columns (null where unseen) and a confidence per row; `readPaytable` maps labels with the pay
  table model's synonyms (`matchAnyRank`, `matchRank`), detects the game from which hands are listed (aces-with-kicker →
  DDB, aces/2–4/5–K → Bonus or Double Bonus by the aces pay, quads 50+ → BPD, deuces hands → Deuces Wild; the model's
  guess only breaks ties), fills missing columns, and lists unknown labels for the player. `photoChecks` adds missing
  hands, non-linear columns and an unusual royal to the editor's checks.
- `hand-photo.ts`: five cards (rank, suit, confidence) + HELD flags + whether a pay table is visible; `handProblem`
  triggers the router's one retry when the cards aren't five different real cards.
- `image.ts`: photos are scaled to ≤ 1,600 px and re-encoded as JPEG on the device (drops EXIF/location); SHA-256
  fingerprint; `imageTokens` estimates per provider. Photos are never stored: `photo-service.ts` caches only the reading
  in `uploads` (fingerprint + model, 90 days), so the same photo read again with the same model is free.
- Vision goes through the same router and providers: `TextRequest.image` (Anthropic image block; OpenAI `input_image`
  data URL). Photos default to the Medium tier (`aiSettings.visionTier`, Dexie v5 sets existing rows to medium).
- UI: `PhotoReader` (camera/file/paste → preview → tier chips with estimates → Read photo), `PayTablePhotoFlow` (read →
  `PayTableEditor` with its `photo` prop: doubtful rows marked "Check", unknown rows to assign, the photo alongside,
  "Looks like …"/"Closest built-in …" → save → `PhotoTableSummary`: return, rank among built-in tables of the game, and
  `strategyDifference` from the worker = share of all deals where the best hold differs from the closest built-in
  table, with examples). Entry points: Settings → Your pay tables → From a photo; machine editor (From a photo…, and
  the "Photograph a pay table" card); Analyzer → From a photo (hand), which offers a second read of a visible pay table.
- Explanations now include the Expert chart line (`chart` in the facts) when charts are already available at max bet.
- Review rules (PR #5):
  - `PhotoReader` owns the preview images it prepares (blob URLs are revoked when replaced or when it closes) until it
    hands one over in `onRead`; a caller returns `false` to decline a reading and leave the image with the reader.
    `initialImage` stays the caller's. A read that completes after the reader closed or its photo changed is dropped.
  - Choosing or pasting a photo invalidates any read in flight immediately; each preparation has its own ticket and only
    the newest is shown (an older one that finishes later is revoked). Read photo is disabled while preparing.
  - Label normalization also drops "any" ("Four Aces with any 2, 3, 4" → the kicker hand).
  - Strategy comparison (`worker/strategy-difference.ts`) counts a deal as changed only when no hold is optimal under
    both tables; deals with a tie on either side are re-solved exactly (stored analyses keep only two holds).
- `pnpm --filter @perfect-draw/web vision-eval <folder> [--provider anthropic|openai] [--tier …]`: scores real photos
  against `<name>.json` answers (`{ "slug": … }` or `{ "familyId", "pays" }`); needs a real key in the environment and
  spends real money. Tests never call real APIs (`e2e/photo.spec.ts` renders images and intercepts the API).

## Cruise rewards tracker (docs/13-CRUISE-TRACKER-PLAN.md)

- Route `#/cruise` (`pages/CruisePage.tsx`). Code in `apps/web/src/cruise/`: `economics.ts` (all arithmetic, pure and
  unit-tested), `useCruise.ts` (live query, expected returns, practice pace), `CruiseDialogs.tsx`, `Planner.tsx`.
  Services in `services/cruise.ts`; luck band simulation in `worker/risk.ts` (`EngineAPI.riskBand`).
- **Only readings are stored** (cash in/out, points before/after, hands, free play, timestamped time segments);
  coin-in, points earned and costs are derived on every read, so editing a program's rules recalculates history.
  `casinoSessions.coinInCents` holds only an estimate (source "estimate"): all play (hours × pace × bet), fixed at
  cash-out; free play is taken off on read when the program says it earns nothing. A correction that leaves a session
  without readings or hands works an estimate out (`estimateFor`, the same rule as the dialog's preview).
- Owner's rules (Club Royale, seeded once by `initializeDatabase`, editable): $15 of coin-in per point; rounding
  `carryover` = a running coin-in total across all of the program's sessions in time order, a point at each full $15;
  free play earns nothing. Coin-in source priority: points Δ × $/point ("within $15"), else hands × bet − free play,
  else active hours × pace × bet. Net = cash out − cash in (free play wins are in the cash out).
- Theoretical cost = coin-in × (1 − effective return). `expectedReturn` (in `useCruise.ts`) gives a `basis`:
  "measured" = Statistics' real-play-weighted return (every kind of deal practiced); "estimated" = its 99%-coverage
  estimate, shown with the imputed share; otherwise "optimal" with the reason (fewer than 200 decisions at that table
  and bet, or too little coverage). The drill-weighted ("as drilled") figure is never used for real play. Results are
  cached per practice version (`practiceOn`: counts, latest change, newest id), and `useExpectedReturns` follows those
  versions with a live query, so new practice, archiving or deleted history is picked up without a reload.
- Coin-in on games without a pay table adds no theoretical cost and is left out of the theoretical cost per point.
  Per-hour rates need 10 minutes of play. Cost per point after rewards uses the signed net (winnings count); return
  on losses is shown only when there was a loss.
- Planner inputs show the trip's current figures (target, points so far, hours left, pace, game, bet) until changed;
  changed inputs stay until "Back to the trip's figures" or switching trips.
- Timer: one live session at a time; segments `{ start, end?, pauseReason? }` (pause reasons drink, break, hand pay
  with amount → `jackpots`, machine fault, other). It survives reloads because nothing ticks in storage.
- Planner = the spec's formulas exactly (`plan`); hours left = planned hours of later days + what's left of today.
  Pace: casino sessions with points/hands (≥ 30 min), else Free Play (`practicePace`, gaps > 60 s are breaks, ≥ 20
  intervals), else 600. Luck band: rare big pays (pay ≥ 20× and < 50 expected) drawn as Poisson counts, the rest
  normal; ≤ 2,000 hands simulated hand by hand; 4,000 trials, seeded. Distribution = `rankProbs` from the manifest
  (library at 5 coins) or computed once and saved in `paytables.summaries[coins].rankProbs`.
- Dexie v6: `casinoSessions` indexed by `startedAt`; the placeholder rounding `trip_floor` becomes `carryover`.
  Backups already included the four tables; Settings notes that a backup now holds financial history.
- Tests: `tests/cruise-economics.test.ts` (incl. the §4 worked example), `tests/risk.test.ts` (matches the spec's
  ±$950 / ±$1,900 example), `tests/cruise-services.test.ts`, `e2e/cruise.spec.ts` (clock-driven timer through a pause
  and a reload, cash-out from point readings, planner example, rewards, CSV, program change). Casino-Pace Mode (F4.8) is
  next.

## Test acknowledgments instead of sleeps

- `apps/web/src/diagnostics.ts` `signal(name)` counts outcomes that leave nothing on screen in
  `window.__perfectDrawSignals` (`photo:read-dropped`, `photo:prepare-dropped`, `explain:reply-dropped`,
  `analyzer:recent-saved`). Tests poll that count instead of `waitForTimeout`. It is a plain counter on purpose:
  Playwright's clock (`page.clock.install()`) stubs the performance timeline, so performance marks read as zero under it
  (the mark is still made, for the browser's performance tools).
- Checks that something did *not* happen after a delay (the recent-hands save) install Playwright's clock, take the
  signal count *before* the input changes, then jump past the delay with `page.clock.runFor(…)` and compare, so a save
  scheduled by the change can't land before the baseline.
- The responsiveness check (mobile Rapid Drill feedback under 50 ms, tagged `@timing` in `e2e/play.spec.ts`) runs as
  its own Playwright project `timing`, in a fresh worker after the `e2e` project, so ~30 earlier tests in the same
  browser don't skew its measurement. If an `e2e` test fails, it is reported as "did not run"; run it alone with
  `pnpm --filter @perfect-draw/web exec playwright test --project=timing --no-deps` (without `--no-deps`, Playwright
  runs the whole `e2e` project first). The visual and offline configs declare their own single project.
