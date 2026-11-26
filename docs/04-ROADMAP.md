# Roadmap & Milestones

Build the engine first and prove it correct; everything else (training, mistake analysis, heuristics) depends on its numbers.

## Phase 0 — Foundation (week 1)
- Monorepo scaffold on Replit (pnpm workspaces, Vite + React PWA, Dexie local DB). No backend; deploy as a Replit Static Deployment.
- Shared Zod types; CI test runner (Vitest).
- Pay table library JSON for MVP families (JoB, Bonus, BPD, DB, DDB, Deuces full-pay, NSUD).

## Phase 1 — Engine (weeks 1–3) ✅ gate: golden tests pass
- Card model, evaluator (non-wild + deuces), 32-hold EV solver over a **value vector** (naive, then fast subset method).
- `GameVariant` interface with only `standard` implemented (multiplier hooks).
- Full-game analysis with suit-isomorphic canonical hands; known returns reproduced.
- Build-time precompute script for library pay tables → static assets.
- Hold-pattern labeler + strategy list induction + tiered lists.
- Web Worker wrapper.

## Phase 2 — MVP Web App (weeks 3–6)
- Machines, wallets (ledger), multi-session switcher, Free Play with 3 feedback modes.
- Rapid Drill + decision logging (local, IndexedDB).
- Export/import backup.
- Hand Analyzer (manual entry) ✅ — `10-HAND-ANALYZER-PLAN.md`.
- Pay table manual editor + library + analysis view.
- Stats: accuracy, EV lost/1000, effective return, confusion matrix, weakness ranking.
- AI settings (bring-your-own OpenAI/Anthropic keys, direct client calls) + provider abstraction ✅ — `11-AI-COACH-PLAN.md`.
- 📸 Pay table photo extraction + confirm grid. 📸 Hand photo extraction. ✅ — `12-PHOTO-CAPTURE-PLAN.md` (accuracy target to be measured with `vision-eval` on real photos).
- AI hand explanations (grounded) ✅ — Explain in every Why? panel, numbers checked against the engine. Explain in plain English *why* one hold beats another and give a way to remember it,
  built on the engine's per-hold breakdown (final-hand chances × pays = EV; see `09-UI-ROUND-2-PLAN.md`, R3). The AI
  writes words only; every number comes from the engine.
- 🛳️ **Cruise Rewards Tracker** (`07-CRUISE-REWARDS.md`): programs (Club Royale default), trips, live casino session timer, coin-in/points/cost per point, rewards ledger, target planner. ✅ — `13-CRUISE-TRACKER-PLAN.md`.
- Casino-Pace Mode + practice session pace/virtual points. ✅ — `14-CASINO-PACE-PLAN.md`.

## Phase 3 — Adaptive Training & Heuristics (weeks 6–9)
- Weakness Trainer, Close Calls, Pay Table Switcher, Strategy Ladder. ✅ — rounds A and B (`15-ADAPTIVE-TRAINING-PLAN.md`, `16-ADAPTIVE-TRAINING-ROUND-B.md`).
- Mastery model + FSRS scheduling. ✅ — `15-ADAPTIVE-TRAINING-PLAN.md` (round A: with Weakness Trainer and Close Calls).
- Heuristic card generation with engine validation; rule lab. ✅ — `17-HEURISTICS-PLAN.md` (engine-written cards, AI polish, Rule Lab).
- Printable strategy/heuristic PDF. ✅ — `18-PRINTABLE-STRATEGY-PLAN.md` (full pages and a wallet card, made in the browser).
- Context analysis (speed/fatigue/switch effects); AI coach report.

## Phase 4 — iOS (weeks 9–11)
- Capacitor shell, native camera, haptics, Keychain key storage, SQLite if needed.
- Backup file transfer between web and iOS (share sheet / file import).
- TestFlight → App Store submission.

## Phase 5 — Expansion
- Optional accounts + cloud sync (Fastify + Replit Postgres + Drizzle, mirroring the local schemas).
- Joker Poker, Triple Double Bonus, Aces & Faces, Super Aces, Bonus Deuces, Loose Deuces…
- Multi-play UI + variance/bankroll simulator.
- Scouting log with map; more rewards programs; iOS Live Activity timer for casino sessions.
- Ultimate X / Super Times Pay / Multi-Strike variants via the existing hooks (`06-MULTIPLIER-GAMES.md`).
- WASM engine port for speed.
