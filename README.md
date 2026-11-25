# Perfect Draw — Video Poker Trainer (spec)

A video poker trainer that computes perfect play for **any** pay table, reads pay tables and hands from **photos**, learns **your** mistake patterns, and trains them away with focused drills and engine-checked heuristics. It supports several machine sessions with separate wallets and lets you choose **OpenAI or Anthropic Claude** for its AI features.

**Primary goal:** earn cruise casino rewards (free cruises) at the lowest cost per point, within the casino hours available on a cruise.

Web first (Replit), then iOS (Capacitor). **Local-first:** guest mode, all data on device, bring-your-own AI key, no backend in the MVP.

## Documents
| Doc | Contents |
|---|---|
| [01 — Feature Brainstorm](docs/01-BRAINSTORM.md) | Full feature list, tiered MVP → stretch |
| [02 — Product Spec](docs/02-PRODUCT-SPEC.md) | Personas, principles, requirements with acceptance criteria, decisions |
| [03 — Technical Spec](docs/03-TECHNICAL-SPEC.md) | Stack, engine algorithms, local data model, services, BYO-key AI layer, mistake analytics, iOS, testing |
| [04 — Roadmap](docs/04-ROADMAP.md) | Phased milestones |
| [05 — Replit Agent Prompts](docs/05-REPLIT-AGENT-PROMPTS.md) | Step-by-step prompts to build it on Replit |
| [06 — Multiplier Games](docs/06-MULTIPLIER-GAMES.md) | Notes and hooks for Ultimate X, Super Times Pay, Multi-Strike (later) |
| [07 — Cruise Rewards Tracker](docs/07-CRUISE-REWARDS.md) | Coin-in, loss, points, cost per point, play time, target planner (Royal Caribbean Club Royale first) |
| [08 — Interface Polish Plan](docs/08-UI-POLISH-PLAN.md) | UI feedback round 1: dialogs, toasts, cards, dollars, feedback, table screen, machine floor, custom pay tables, felts, assets |
| [09 — Interface Round 2 Plan](docs/09-UI-ROUND-2-PLAN.md) | Popular machines, bet changes at the table, why-this-hold breakdown, table analysis fix |
| [10 — Hand Analyzer Plan](docs/10-HAND-ANALYZER-PLAN.md) | Enter any hand, every hold ranked with why, strategy-line citation, across pay tables |
| [11 — AI Coach Plan](docs/11-AI-COACH-PLAN.md) | Bring-your-own-key AI layer, AI settings, grounded "Explain" with a number check |
| [12 — Photo Capture Plan](docs/12-PHOTO-CAPTURE-PLAN.md) | Pay table and hand photos read by AI, mapped and checked by the app, confirmed by you |

## Core principle
**Math is deterministic; AI only reads images and writes words.** Every EV, strategy line and statistic comes from the engine. LLM output is schema-validated, checked against engine data, and confirmed by the user when it comes from a photo.
