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
  Opening/switching/pausing sessions does not spend credits. `saveHand` is a
  state-persistence primitive for the Prompt 6 game loop, not a payout action.
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
- Free Play deal/draw, feedback, decision logging and drills remain Prompt 6.
  AI settings/key entry remain Prompt 8; cruise workflows remain Prompt 7b.
