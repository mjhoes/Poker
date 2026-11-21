# Perfect Draw on Replit

## Run locally

- Start the web app with `pnpm dev`.
- Build the static site with `pnpm build`.
- Run engine tests with `pnpm test`.

The web app is served by Vite on port 5000. The Replit development workflow runs
the web client; production publishing uses a Static Deployment from
`apps/web/dist`.

## Project constraints

- Keep the MVP client-only: no backend server, database server, or login.
- Persist user data locally in IndexedDB through Dexie.
- Make AI calls directly from the client with the user's own provider key.
- Keep all expected-value and strategy calculations deterministic in
  `packages/engine`; never delegate math to an LLM.
