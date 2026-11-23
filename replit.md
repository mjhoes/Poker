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
- AI settings/key entry remain Prompt 8; cruise workflows remain Prompt 7b.

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

