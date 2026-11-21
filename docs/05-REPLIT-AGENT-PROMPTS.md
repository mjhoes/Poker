# Replit Agent Prompts (paste one phase at a time)

**How to use:** In Replit, choose *Import from GitHub* → this repo. Then give the Agent the prompts below **one at a time**, checking each result before moving on. Each prompt points the Agent at the spec files so it stays on track.

**No secrets or database setup needed.** The MVP is local-first: there's no backend, and you enter your own OpenAI/Anthropic key inside the app's Settings screen. Deploy as a **Static Deployment**. (Optional, for prompt 9's dev-only eval script: put your keys in Replit Secrets as `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`; the app itself never reads them.)

**Standing instruction to repeat if the Agent drifts:** "No backend, no database server, no login. All user data in IndexedDB via Dexie. AI calls go from the client with the user's own key. All EV/strategy math comes from `packages/engine`, never from an LLM."

---

### Prompt 1 — Scaffold
> Read `docs/02-PRODUCT-SPEC.md` (especially §7 Decisions) and `docs/03-TECHNICAL-SPEC.md`. Create the pnpm monorepo per Tech Spec §1 "Repo layout" (skip `apps/server` and `apps/ios` for now): `apps/web` (React 18 + Vite + TypeScript + Tailwind + Zustand, PWA via vite-plugin-pwa, Dexie), `packages/engine`, `packages/shared` (Zod), `packages/paytables`, `packages/precomputed`, `scripts/`. Add Vitest. Configure Replit to run the web dev server and to deploy as a static site. No features yet, just a placeholder home page.

### Prompt 2 — Engine core
> Implement `packages/engine` per Tech Spec §3.1–3.3: card ints, a lookup-table evaluator for Jacks or Better, Bonus Poker, Bonus Poker Deluxe, Double Bonus, Double Double Bonus and Deuces Wild, and `analyzeHand(cards, valueVector)` returning all 32 holds sorted by EV. Important: the solver takes a value vector indexed by hand rank, not a pay table (see the hook note in §3.3). Also add the `GameVariant` interface from §3.9 with only the `standard` variant implemented. Write the naive enumeration first, with Vitest tests on known hands. Pure TypeScript, no DOM/Node APIs.

### Prompt 3 — Full-game analysis, precompute, golden tests
> Add `analyzeGame(family, valueVector, onProgress)` per Tech Spec §3.4 using the 134,459 suit-isomorphic canonical hands with weights, plus the fast subset/inclusion–exclusion solver from §3.3 (count tables per rank, built once per family). Add the pay table library (9/6 JoB, 8/5 JoB, 8/5 Bonus, 9/6 BPD, 10/7 DB, 9/6 DDB, Full-Pay Deuces, NSUD). Write `scripts/precompute.ts` that writes compressed analyses for every library table into `packages/precomputed`. Golden tests: returns match Product Spec F1.2 within ±0.005%; fast solver equals naive on 1,000 random hands; the value-vector scaling test from §10.

### Prompt 4 — Labeler + strategy lists
> Implement hold-pattern labeling (§3.5), strategy list induction with tiers (§3.6), the heuristic validator (§3.7) and the drill hand generator (§3.8). The Expert list for 9/6 Jacks or Better must be within 0.02% of optimal; save the generated list as a test snapshot I can review.

### Prompt 5 — Local data, machines, wallets, sessions
> Implement the Dexie schema in Tech Spec §4 (Zod schemas in `packages/shared`, UUIDv7 IDs, `updatedAt`/`deletedAt` on every record, `variant` fields defaulting to `standard`) and the services in §5 for machines, wallets (ledger, top-up, transfer) and sessions. Run the engine in a Web Worker via Comlink. Build the UI: Home with a machine carousel, machine create/edit (pick from library), wallet management, and the persistent multi-session switcher bar (§8). Persist session state on every action. Add Export/Import backup and `navigator.storage.persist()` (§4 Data safety).

### Prompt 6 — Free Play + Rapid Drill + logging
> Build the Free Play machine screen (Product Spec F4.1) with 3 feedback modes and keyboard shortcuts (1–5 hold, Space/Enter deal/draw), and the Rapid Drill (F4.2). Log every decision with all fields of the `decisions` table.

### Prompt 7 — Stats & mistake intelligence
> Implement Tech Spec §6: per-category stats, confusion matrix, weakness score, effective return ("as drilled" and "real-play weighted"). Build the Stats screen (F5.1–F5.3) with charts, a sortable confusion matrix and a weakness list with a "Train this" button.

### Prompt 8 — AI provider layer (bring your own key)
> Implement Tech Spec §7.1–7.2 in `apps/web/src/ai`: OpenAI and Anthropic providers using the official SDKs called directly from the browser with `dangerouslyAllowBrowser: true`, the user's own key (in memory by default; IndexedDB only if "Remember key on this device" is on, with the warning text from §7.1), per-task provider/model settings, optional fallback, Zod validation with one retry, and the `aiUsage` log. Build the AI Settings screen with key entry, a "Test connection" button per provider, and model pickers. Add the Content-Security-Policy from §7.1. With no key, AI features show an "add a key" prompt.

### Prompt 9 — Photo capture
> Implement `paytable_extract` and `hand_extract` (§7.3–7.4) with Zod structured outputs, a hand-name synonym dictionary, validation rules (F2.2) and the confirm/edit UIs (F2.3, F3.1). Use `<input type="file" accept="image/*" capture="environment">` on web, resize on device. After a pay table is confirmed, run `analyzeGame` in the worker with a progress bar, cache it, and show return %, common name and strategy differences vs the library base table. If the photo looks like Ultimate X or another multiplier game, say "not supported yet" and offer to save it as the base game. Also add `scripts/vision-eval.ts` (dev-only, reads keys from env) for the photo test set.

### Prompt 10 — Hand Analyzer + explanations
> Build the Analyze screen (F3.2–F3.4): manual entry + photo, all 32 holds ranked, strategy-line citation, and the grounded `explain_hand` explanation, including the client check that every number in the LLM text appears in the engine data.

### Prompt 11 — Adaptive training & heuristics
> Implement Weakness Trainer, Close Calls, Pay Table Switcher and Strategy Ladder (F4.3–F4.6), the Beta mastery model + FSRS scheduling (F4.7, Tech §6), and heuristic card generation with engine validation and the rewrite loop (F6.1–F6.2). Add the printable PDF strategy card (F6.3), generated client-side.

### Prompt 12 — iOS (Capacitor)
> Add Capacitor to `apps/web` and create `apps/ios` per Tech Spec §9. Use `@capacitor/camera` when running natively, Keychain secure storage for API keys, haptics on hold toggles, and share-sheet export/import for backups. Document the Xcode build steps in `apps/ios/README.md`.

---

**Tips for working with Replit Agent**
- After each prompt, run the tests yourself (`pnpm test`) before continuing.
- If the Agent tries to add a backend/database/login, or to "simplify" the engine with an LLM or hard-coded strategy, stop it and repeat the standing instruction above.
- Commit after each phase so you can roll back.
