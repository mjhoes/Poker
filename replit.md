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
Persistent IndexedDB caching and worker/UI integration belong to later prompts.

Engine EVs use total returned coins. Full-game analysis explicitly divides by
`betCoins`; its variance is single-line variance per unit bet. Canonical-index
hold masks must be remapped to the user's original card order before use.

## Project constraints

- Keep the MVP client-only: no backend server, database server, or login.
- Persist user data locally in IndexedDB through Dexie.
- Make AI calls directly from the client with the user's own provider key.
- Keep all expected-value and strategy calculations deterministic in
  `packages/engine`; never delegate math to an LLM.
