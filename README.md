# Perfect Draw — Video Poker Trainer (spec)

A video poker trainer that computes perfect play for **any** pay table, reads pay tables and hands from **photos**, learns **your** mistake patterns, and trains them away with focused drills and engine-checked heuristics. It supports several machine sessions with separate wallets and lets you choose **OpenAI or Anthropic Claude** for its AI features.

Web first (Replit), then iOS (Capacitor).

## Documents
| Doc | Contents |
|---|---|
| [01 — Feature Brainstorm](docs/01-BRAINSTORM.md) | Full feature list, tiered MVP → stretch |
| [02 — Product Spec](docs/02-PRODUCT-SPEC.md) | Personas, principles, requirements with acceptance criteria, open questions |
| [03 — Technical Spec](docs/03-TECHNICAL-SPEC.md) | Stack, engine algorithms, data model, API, LLM layer, mistake analytics, iOS, testing |
| [04 — Roadmap](docs/04-ROADMAP.md) | Phased milestones |
| [05 — Replit Agent Prompts](docs/05-REPLIT-AGENT-PROMPTS.md) | Step-by-step prompts to build it on Replit |

## Core principle
**Math is deterministic; AI only reads images and writes words.** Every EV, strategy line and statistic comes from the engine. LLM output is schema-validated, checked against engine data, and confirmed by the user when it comes from a photo.
