# Roadmap & Milestones

Build the engine first and prove it correct; everything else (training, mistake analysis, heuristics) depends on its numbers.

## Phase 0 — Foundation (week 1)
- Monorepo scaffold on Replit (pnpm workspaces, Vite web, Fastify server, Drizzle + Replit Postgres).
- Shared Zod types; CI test runner (Vitest).
- Pay table library JSON for MVP families (JoB, Bonus, BPD, DB, DDB, Deuces full-pay, NSUD).

## Phase 1 — Engine (weeks 1–3) ✅ gate: golden tests pass
- Card model, evaluator (non-wild + deuces), 32-hold EV solver (naive, then fast subset method).
- Full-game analysis with suit-isomorphic canonical hands; known returns reproduced.
- Hold-pattern labeler + strategy list induction + tiered lists.
- Web Worker wrapper.

## Phase 2 — MVP Web App (weeks 3–6)
- Machines, wallets (ledger), multi-session switcher, Free Play with 3 feedback modes.
- Rapid Drill + decision logging (offline-first, sync).
- Hand Analyzer (manual entry).
- Pay table manual editor + library + analysis view.
- Stats: accuracy, EV lost/1000, effective return, confusion matrix, weakness ranking.
- AI settings (OpenAI/Anthropic, app key or BYO key) + provider abstraction.
- 📸 Pay table photo extraction + confirm grid. 📸 Hand photo extraction.
- AI hand explanations (grounded).

## Phase 3 — Adaptive Training & Heuristics (weeks 6–9)
- Weakness Trainer, Close Calls, Pay Table Switcher, Strategy Ladder.
- Mastery model + FSRS scheduling.
- Heuristic card generation with engine validation; rule lab.
- Printable strategy/heuristic PDF.
- Context analysis (speed/fatigue/switch effects); AI coach report.

## Phase 4 — iOS (weeks 9–11)
- Capacitor shell, native camera, haptics, SQLite if needed.
- Account sync between web and iOS.
- TestFlight → App Store submission.

## Phase 5 — Expansion
- Joker Poker, Triple Double Bonus, Aces & Faces, Super Aces, Bonus Deuces, Loose Deuces…
- Multi-play UI + variance/bankroll simulator.
- Casino Companion (real-session logging), scouting log with map.
- Ultimate X / Super Times Pay / Multi-Strike engines.
- WASM engine port for speed.
