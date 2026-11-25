# AI round — bring-your-own-key layer and grounded explanations

Spec: F8 (AI provider settings) and the `explain_hand` part of F3.3 in `02-PRODUCT-SPEC.md`; Tech Spec §7.1–7.3;
Prompt 8 and the explanation half of Prompt 10 in `05-REPLIT-AGENT-PROMPTS.md`; the roadmap note on grounded
explanations ("the AI writes words only; every number comes from the engine").
Status: **built** (see replit.md "AI coach").

Goal: press **Explain** on any hold comparison (after a hand, or in the Analyzer) and get a short plain-English
explanation of why the best hold wins and a way to remember it — written by the AI, but every number in it checked
against the engine's numbers before it is shown.

## Principles (unchanged from the spec)
- **Math is deterministic; AI only writes words.** The model receives the engine's numbers and must not introduce new
  ones. The app checks this; a failing explanation is never shown.
- **Your key, your browser.** No backend. Calls go straight from the browser to the provider with the player's own key.
- **Everything works without a key.** AI features show "Add an API key in Settings"; nothing else changes.

## B1 — AI layer (`apps/web/src/ai/`)
- `LLMProvider` interface from Tech Spec §7.2 (`text`, `vision` later, `test`).
- **Anthropic provider** on the official SDK (`@anthropic-ai/sdk`) with `dangerouslyAllowBrowser: true`, which sends the
  header that lets the browser call the API directly. Structured output with the SDK's Zod helper
  (`messages.parse` + `zodOutputFormat`), so replies are schema-checked.
  - Refusals (`stop_reason: "refusal"`) are handled as a friendly "the model declined" message, and the server-side
    refusal fallback is turned on by default (it re-runs a declined request on a fallback model inside the same call).
  - Typed SDK errors map to plain messages: bad key, rate limited (retry later), no credit, network/offline.
- **OpenAI provider** on the official `openai` SDK, same interface (see question 1).
- **Router** `runTask(task, input)`: picks the provider and model set for the task, validates with Zod, retries once on
  a schema or number-check failure, falls back to the other provider only if that is turned on and its key exists, and
  writes a usage row.
- **Models are settings, not code.** Defaults in one `ai/models.ts` (see question 2), overridable per task.
- **Usage log** (`aiUsage`, already in the data model): provider, model, task, input/output tokens and an estimated cost
  from a price table in `models.ts` (labelled "estimate — check your provider's billing").

## B2 — Keys and AI settings (Settings → AI)
- One card per provider: key field (hidden text), **Test connection**, model picker per task, and **Forget key**.
- **Remember key on this device** — off by default (key held in memory for the session only). When on, the key is stored
  in IndexedDB with the plain warning from the spec: "Stored unencrypted in this browser. Anyone with access to this
  device or browser profile can read it."
- Keys are never exported in backups (already true) and never logged.
- Optional **fallback to the other provider** toggle.
- **Usage** summary: this month's calls, tokens and estimated cost, by task; a "Clear usage log" button.

## B3 — Content-Security-Policy
- Production build adds a CSP limiting `connect-src` to the app itself, `api.anthropic.com` and `api.openai.com`, with no
  third-party scripts — to reduce the risk to stored keys. (Dev server keeps Vite's needs; the CSP applies to `pnpm build`,
  which is what Replit deploys.) The offline test confirms the PWA still works under it.

## B4 — Explain (the `explain_hand` task)
- **Where:** an **Explain** button in the Why? panel — the details drawer after any hand and the Analyzer's comparison.
  The comparison it explains is whatever the panel shows (best vs your hold, the runner-up, or any hold you picked).
- **What the model receives** (built by a pure, unit-tested `explainFacts()`): the five cards; game, pay table and bet;
  both holds (cards and names) with their values; each final hand's chance ("1 in 1,081"), value and difference; the
  deciding hands; the strategy-chart line when known; and the engine's own summary sentence. Nothing else.
- **What it returns:** `{ summary, why, howToRemember, commonMistake? }` — a few short sentences, schema-validated.
- **Number check** (pure, unit-tested `checkNumbers(text, facts)`): every number in the reply ("2.81", "1 in 47", "100%",
  "4 to a flush") must appear in the facts, allowing only formatting differences (thousands separators, rounding to the
  shown precision, "47" vs "1 in 47"). On failure: one retry telling the model which numbers were not in the data; if it
  still fails, nothing AI-written is shown — "The explanation didn't match the engine's numbers, so it isn't shown" —
  and the engine's summary stays.
- **Shown as:** the explanation with a small line "Written by AI from the engine's numbers · Claude Opus 5.5 · about
  $0.02", plus **Regenerate**.
- **Saved on the device** so reopening the same comparison doesn't pay twice (see question 4); keyed by hand, table,
  bet, both holds, model and prompt version.
- **No key:** the button reads "Explain (add an API key)" and opens Settings → AI.

## B5 — Testing
- **Unit:** facts builder (only engine numbers, all of them); number check (accepts reformatting, rejects a new or
  changed number, handles card ranks and hold names like "4 to a Royal"); router (schema retry, number-check retry,
  fallback only with a key, usage row with tokens and cost, refusal and error mapping); key storage (memory by default,
  IndexedDB only when remembered, forget clears both); backups still exclude keys.
- **Browser:** no real API calls in tests — Playwright intercepts `api.anthropic.com` and returns canned replies. Checks:
  the key and direct-browser header are sent; a good reply shows; a reply with an invented number is retried and then
  hidden; the no-key prompt; Test connection success and failure; the usage log; explanations reopen from the device.
- **Real-key check:** you add your key in Settings on your own device and press Test connection and Explain. I never see
  the key and it never touches the repository.

## B6 — Not in this round
- Photo capture of pay tables and hands (next round; it reuses this layer's `vision` and settings).
- `heuristic_generate` and `coach_report` (adaptive-training round).

## Decisions (confirmed)
1. **Both providers now:** Anthropic and OpenAI, each on its official SDK.
2. **Model selector with three tiers**, beside the Explain button and as the default in Settings → AI:

   | Tier | Anthropic | OpenAI | $ per 1M tokens (input / output) |
   |---|---|---|---|
   | Light | `claude-haiku-5-5` | `gpt-6-luna` | $0.10 / $0.50 (both) |
   | Medium | `claude-sonnet-5-5` | `gpt-6.2-sol` | $2 / $10 (both) |
   | Heavy (default) | `claude-opus-5-5` | `gpt-6.2-astra` | $4 / $20 · $8 / $40 |

   OpenAI's tiers follow its own guidance (Astra flagship, Sol balanced, Luna cost-sensitive); IDs and standard prices
   were read from developers.openai.com on 2026-11-25. Anthropic's from Anthropic's current model table. Prices live in
   `ai/models.ts` and are labelled as estimates.
3. **Explain only when asked** — no automatic calls. **Cost estimates for testing:** each tier shows an estimated cost
   before you press Explain (from the size of the request and a typical reply), and each explanation shows its actual
   cost afterwards (from the provider's token counts). Settings → AI shows the running usage log. Test connection uses
   the providers' free model-list endpoints, so it costs nothing.
4. **Explanations are saved on the device** and reopened for free.

## Rough cost per explanation (estimate)
About 2–4K tokens in and a few hundred out. Claude Opus 5.5 ($4 / $20 per million tokens): roughly 2–4¢. Claude
Sonnet 5.5 ($2 / $10): roughly 1–2¢. Claude Haiku 5.5 ($0.10 / $0.50): well under 1¢. The usage log shows the real
figures once you use it.

## Questions
1. **Providers this round:** Anthropic only now and OpenAI with the photo round, or both now? (Spec has both.)
2. **Default model for explanations:** Claude Opus 5.5 (best writing, ~2–4¢), Claude Sonnet 5.5 (~1–2¢), or Claude
   Haiku 5.5 (well under 1¢)? Any can be changed in Settings.
3. **When to explain:** only when you press Explain (no surprise costs), or automatically after each mistake?
4. **Save explanations on this device** so the same comparison is never paid for twice?
