# Replit Agent Prompts (paste one phase at a time)

**How to use:** In Replit, choose *Import from GitHub* → this repo. Then give the Agent the prompts below **one at a time**, checking each result before moving on. Each prompt points the Agent at the spec files so it stays on track.

Before you start, add these in **Replit → Secrets**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `KEY_ENCRYPTION_SECRET` (32+ random chars). Then create a Replit PostgreSQL database (it sets `DATABASE_URL`).

---

### Prompt 1 — Scaffold
> Read `docs/02-PRODUCT-SPEC.md` and `docs/03-TECHNICAL-SPEC.md`. Create the pnpm monorepo exactly as in Tech Spec §1 "Repo layout": `apps/web` (React 18 + Vite + TypeScript + Tailwind + Zustand + TanStack Query, PWA), `apps/server` (Fastify + TypeScript + Drizzle using `DATABASE_URL`), `packages/engine`, `packages/shared` (Zod schemas), `packages/paytables`. Add Vitest. Set up the Replit run command to start the server and the web dev server together, with the web app proxying `/api` to the server. No features yet: just a health endpoint and a placeholder home page.

### Prompt 2 — Engine core
> Implement `packages/engine` per Tech Spec §3.1–3.3: card ints (0–51, 52=joker), a lookup-table hand evaluator for the game families in `packages/paytables` (start with Jacks or Better, Bonus Poker, Bonus Poker Deluxe, Double Bonus, Double Double Bonus, Deuces Wild), and `analyzeHand(cards, payTable, coins)` returning all 32 holds sorted by EV. Write the naive enumeration first, then add Vitest tests with known hands. Pure TypeScript, no DOM or Node APIs, so it runs in a Web Worker.

### Prompt 3 — Full-game analysis + golden tests
> Add `analyzeGame(payTable)` per Tech Spec §3.4 using the 134,459 suit-isomorphic canonical hands with weights, and the fast subset/inclusion–exclusion method from §3.3. Add the pay table library JSON (9/6 JoB, 8/5 JoB, 8/5 Bonus, 9/6 BPD, 10/7 DB, 9/6 DDB, Full-Pay Deuces, NSUD). Golden tests: returns must match Product Spec F1.2 within ±0.005%, and the fast solver must equal the naive solver on 1,000 random hands. Run as a Node worker_thread on the server; cache results in a `paytable_analyses` table keyed by pay table hash.

### Prompt 4 — Labeler + strategy lists
> Implement hold-pattern labeling (Tech Spec §3.5) and strategy list induction with tiers (§3.6), plus the heuristic validator (§3.7) and drill hand generator (§3.8). Tests: the Expert list for 9/6 Jacks or Better must come within 0.02% of optimal; print the generated list in a test snapshot so I can review it.

### Prompt 5 — Data model, machines, wallets, sessions
> Implement the Drizzle schema in Tech Spec §4 and the CRUD APIs in §5 for machines, wallets (with ledger, top-up, transfer) and sessions. Build the web UI: Home with a machine carousel, machine create/edit (pick a pay table from the library), wallet management, and the persistent multi-session switcher bar from §8. Session state persists to IndexedDB (Dexie) on every action and syncs to the server.

### Prompt 6 — Free Play + Rapid Drill + logging
> Build the Free Play machine screen (Product Spec F4.1) with the 3 feedback modes, keyboard shortcuts (1–5 hold, Space/Enter deal/draw), and the Rapid Drill (F4.2). Run the engine in a Web Worker via Comlink. Log every decision with all fields of the `decisions` table; batch-sync per §8.

### Prompt 7 — Stats & mistake intelligence
> Implement Tech Spec §6: per-category stats, confusion matrix, weakness score, and effective return (both "as drilled" and "re-weighted to real play"). Build the Stats screen (Product Spec F5.1–F5.3) with charts, a sortable confusion matrix, and a weakness list with a "Train this" button.

### Prompt 8 — AI provider layer + settings
> Implement Tech Spec §7.1: an `LLMProvider` interface with OpenAI and Anthropic implementations using their official SDKs, a router with per-task provider/model settings, app-key vs BYO-key (AES-256-GCM encrypted with `KEY_ENCRYPTION_SECRET`), optional fallback, and the `ai_usage` log. Build the AI Settings screen with a "Test connection" button for each provider. Keep model IDs in one config file.

### Prompt 9 — Photo capture
> Implement the `paytable_extract` and `hand_extract` tasks (§7.2–7.3) with Zod-validated structured outputs, a hand-name synonym dictionary, validation rules (Product Spec F2.2), and the confirm/edit UIs (F2.3, F3.1). Use the device camera via `<input type="file" accept="image/*" capture="environment">` on web. After a pay table is confirmed, trigger the analysis and show return %, common name and strategy differences vs the library base table.

### Prompt 10 — Hand Analyzer + explanations
> Build the Analyze screen (F3.2–F3.4): manual entry + photo, all 32 holds ranked, strategy-line citation, and the grounded `explain_hand` AI explanation, including the server check that every number in the LLM text appears in the engine data.

### Prompt 11 — Adaptive training & heuristics
> Implement Weakness Trainer, Close Calls, Pay Table Switcher and Strategy Ladder (F4.3–F4.6), the Beta mastery model + FSRS scheduling (F4.7, Tech §6), and heuristic card generation with engine validation and rewrite loop (F6.1–F6.2). Add the printable PDF strategy card (F6.3).

### Prompt 12 — iOS
> Add Capacitor to `apps/web`, configure `apps/ios`, and swap file-input capture for `@capacitor/camera` when running natively. Add haptics on hold toggles. Document the Xcode build steps in `apps/ios/README.md`.

---

**Tips for working with Replit Agent**
- After each prompt, run the tests yourself (`pnpm test`) before continuing.
- If the Agent tries to "simplify" the engine with an LLM or hard-coded strategy, stop it and point to Design Principle #1 in the Product Spec.
- Commit after each phase so you can roll back.
