# Technical Spec

> **Primary goal:** cruise casino rewards at the lowest cost per point. The Rewards Tracker module is specified in `07-CRUISE-REWARDS.md` (its data model and services extend §4–§5).
>
> **Decided:** bring-your-own AI key, local guest mode (no accounts), no monetization for now, MVP games = JoB / Bonus / BPD / DB / DDB / Deuces (full-pay + NSUD), multiplier games later (hooks in §3.9 + `06-MULTIPLIER-GAMES.md`), iOS via Capacitor.
>
> **Consequence: the MVP is local-first with no backend.** All data lives on the device, the engine runs on the device, and AI calls go straight from the device to OpenAI/Anthropic with the user's own key. Replit hosts a static site. A server (accounts + sync) is a later, optional phase, and the local service layer (§5) is written so a server can implement the same contracts later.

## 1. Stack (Replit, web first → iOS)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for engine, web and iOS shell. |
| Monorepo | pnpm workspaces | `packages/engine` shared by web and iOS. |
| Web client | **React 18 + Vite + Tailwind + Zustand** | Fast on Replit, PWA-capable. |
| Local database | **IndexedDB via Dexie** (iOS: same, or SQLite via `@capacitor-community/sqlite` if storage limits bite) | Guest mode: all user data on device. |
| Heavy math | Web Worker via Comlink; optional **Rust→WASM** speed-up later | Keeps UI at 60 fps. |
| AI | Official `openai` and `@anthropic-ai/sdk` SDKs **called from the client** with the user's key | No server needed to hold or relay keys. |
| Hosting | **Replit Static Deployment** (PWA) | No backend in MVP. |
| iOS | **Capacitor** wrapping the same web build; Camera, Haptics, Keychain-backed secure storage | Reuses ~100% of UI. |
| Tests | Vitest (engine/unit), Playwright (e2e) | |
| *Later* | Fastify + Replit Postgres + Drizzle + auth, for optional accounts/sync | Not in MVP. |

### Repo layout
```
/apps
  /web            React app (PWA) — includes local services, AI client, Dexie DB
  /ios            Capacitor project (phase 4)
  /server         (later) optional accounts + sync API
/packages
  /engine         Pure TS: cards, evaluator, EV solver, strategy, labeling, variants
  /shared         Zod schemas & types (DB records, AI outputs, service contracts)
  /paytables      JSON library of known pay tables + game family defs
  /precomputed    build-time output: analyses for library pay tables (static assets)
/scripts          build-time precompute (node) for library pay tables
/docs
```

## 2. Domain Model: Games & Pay Tables

### 2.1 Game family (data-driven)
```ts
type GameFamily = {
  id: string;                 // "jacks_or_better", "deuces_wild", "double_double_bonus"
  deck: { size: 52 | 53; jokers: 0 | 1 };
  wilds: "none" | "deuces" | "joker";
  handRanks: HandRankId[];    // ordered best → worst for this family
  rankRules?: {
    quadKickers?: boolean;    // DDB "4 Aces w/ 2-4"
    minPair?: "J" | "T" | "K";
  };
};
```
`HandRankId` examples: `ROYAL_FLUSH`, `NATURAL_ROYAL`, `FOUR_DEUCES`, `WILD_ROYAL`, `FIVE_KIND`, `STRAIGHT_FLUSH`, `FOUR_ACES_W_234`, `FOUR_234_W_A234`, `FOUR_ACES`, `FOUR_234`, `FOUR_5K`, `FULL_HOUSE`, `FLUSH`, `STRAIGHT`, `THREE_KIND`, `TWO_PAIR`, `JACKS_OR_BETTER`, …

MVP families: Jacks or Better, Bonus Poker, Bonus Poker Deluxe, Double Bonus, Double Double Bonus, Deuces Wild (full-pay and NSUD are pay tables of the same family). Joker support (53-card deck) is designed in but not built.

### 2.2 Pay table
```ts
type PayTable = {
  id: string;                     // sha256 of canonical JSON → cache key
  familyId: string;
  name?: string;                  // "9/6 Jacks or Better"
  pays: Record<HandRankId, [number, number, number, number, number]>; // coins 1..5
  source: "library" | "photo" | "manual";
};
```
Strategy uses the per-coin pay at the chosen bet (royal is usually 250/coin at 1–4 coins, 800/coin at max).

## 3. Engine (`packages/engine`)

### 3.1 Card representation
- Card = integer 0–51 (`rank*4 + suit`), 52 = joker.
- Hand = sorted 5-int array; also a 52-bit mask (two 32-bit ints) for set operations.

### 3.2 Hand evaluator
- Non-wild: lookup table over all C(52,5)=2,598,960 hands → family `HandRankId` index (built in ~1 s in the worker at startup, or loaded as a compact binary asset).
- Deuces Wild: evaluate (natural cards, wild count) via a precomputed table keyed by natural rank pattern + suitedness + wild count.

### 3.3 EV solver for one hand (all 32 holds)

> **Hook for multiplier games:** the solver never reads a pay table directly. It takes a **value vector** `V[handRankId]` (value of finishing in each rank). For standard games `V = pays[coins]`. Variants (§3.9) build different vectors. Keep this indirection from day one.

For each hold mask `h` (32 subsets), draw `k = 5 − |h|` from the 47 remaining cards:
EV(h) = Σ over all C(47,k) draws of V[rank(final hand)] / C(47,k).

- **Naive**: ~2.6M evaluations per hand. Fine in a worker with a lookup evaluator (~100–300 ms JS).
- **Fast method** (needed for full-game analysis): precompute `T[S][rank]` = the number of 5-card hands containing subset S, for every subset |S| ≤ 5, grouped by rank. For a deal, count the draws that **exclude the discarded cards** using inclusion–exclusion over subsets of the discards. Because the counts are stored per rank (not per payout), the same tables serve any value vector, so tables are built once per *family* and reused for every pay table and multiplier state.
- Return type:
```ts
type HoldResult = { mask: number; ev: number; label: CategoryLabel; rankDist: number[] };
type HandAnalysis = { hand: Card[]; results: HoldResult[] /* desc */; best: HoldResult; gapToSecond: number };
```

### 3.4 Full-game analysis
- Enumerate the 134,459 **suit-isomorphic** canonical starting hands (with multiplicity weights).
- For each: solve all 32 holds, take the max, accumulate return, variance and the frequency of each rank.
- Output `GameAnalysis { returnPct, variance, hitFreq, rankProbs, perHand: Map<canonicalHandId, {bestMask, ev, secondEv, bestLabel, secondLabel}> }`.
- `perHand` (~134k rows, ≈2–3 MB compressed) is the **core training index**.
- **Library pay tables:** precomputed at build time (`scripts/precompute.ts`) and shipped as static assets in `packages/precomputed`, lazy-loaded and cached in IndexedDB.
- **New pay tables (photo/manual):** computed on device in the worker with a progress bar (target < 30 s TS, < 5 s WASM), then stored in IndexedDB keyed by `hash(familyId + valueVector)`.

### 3.5 Hold-pattern labeling (vocabulary)
A deterministic function `label(heldCards, fullHand, family) → CategoryLabel`:

| Group | Labels (non-wild examples) |
|---|---|
| Made hands | `RF`, `SF`, `4K`, `FH`, `FL`, `ST`, `3K`, `2P`, `HP` (high pair), `LP` (low pair) |
| 4-card draws | `4RF`, `4SF_open`, `4SF_inside`, `4FL`, `4ST_open_hN`, `4ST_inside_hN` (N = # high cards) |
| 3-card draws | `3RF_hN`, `3SF_t1|t2|t3` (type by gaps/high cards), `KQJ_unsuited`, `3FL_hN` |
| 2-card | `2RF_AK` … `2RF_JT`, `2SH_suited`, `2H_unsuited` (e.g. `QJ`, `KQ`), `AK_unsuited` … |
| 1-card | `1H_A`, `1H_K` … |
| Nothing | `DRAW5` |

Deuces Wild uses a vocabulary keyed on the number of deuces held (`D2_4K`, `D1_4SF`, `D0_3RF`, …).
Penalty modifiers attach as suffixes (`2RF_QJ|pen:flush`, `|pen:straight`), computed by checking for discards that reduce the hold's outs. The labeler is independent of pay values, so it works unchanged for multiplier games.

### 3.6 Strategy list induction
1. From `perHand`, for each canonical hand gather `{labels present (best hold per label), optimal label}`.
2. Build a pairwise precedence graph (edge A→B weighted by how often A beats B when both are present, weighted by hand frequency).
3. Topologically sort; where precedence is inconsistent, split the label with penalty-card or high-card modifiers until consistency is ≥ 99.9% (by frequency).
4. Score the list by playing it over all canonical hands → `listReturnPct`. Tiers: **Perfect** (engine), **Expert** (full list, gap ≤ 0.02%), **Intermediate** (merged lines, no penalty refinements), **Beginner** (≤ 12 lines, greedy min-cost).
5. Store `StrategyList { tier, lines: [{label, rank, exceptions[], freq, costIfIgnored}], returnPct }`, keyed by the same analysis key as §3.4 (so a multiplier state can have its own list later).

### 3.7 Heuristic validator
`evaluateRule(rule: RuleAST, analysisKey) → { returnPct, costVsOptimal, handsAffected, counterexamples[] }`. The LLM proposes rules as **JSON ASTs** ("prefer A over B unless penalty P"); the engine scores them.

### 3.8 Drill hand generator
`generateHand({ analysisKey, targetPairs: [{correct, confusedWith}], closeCallMaxGap?, excludeRecent })`
- Pre-index `perHand` by (bestLabel, secondLabel).
- Sample a canonical hand, apply a random suit permutation + card-order shuffle.

### 3.9 Variant hooks (multiplier games later)
Build these interfaces now, even though only `standard` ships in the MVP:
```ts
type VariantKind = "standard" | "ultimate_x" | "super_times_pay" | "multi_strike" | "dream_card";

interface GameVariant {
  kind: VariantKind;
  config: unknown;                               // variant-specific (multiplier tables, lines, etc.)
  // Value of finishing in each rank, given current per-line state:
  valueVector(payTable: PayTable, coins: number, state: VariantState): number[];
  // How state evolves after a hand resolves (e.g. Ultimate X awards next-hand multipliers):
  nextState(state: VariantState, finalRanksPerLine: HandRankId[]): VariantState;
  // Cost per hand (Ultimate X / STP charge extra coins):
  betCoins(coins: number, lines: number): number;
}
type VariantState = { lineMultipliers?: number[]; level?: number; [k: string]: unknown };
```
- `standard` = identity (`valueVector = pays[coins]`, empty state, `betCoins = coins × lines`).
- Session state, machine config and decision records all carry `variant` + `variantState` fields (nullable/default `standard`) so stats can later be split by multiplier context.
- Analysis cache keys include the value vector, so analyses for each multiplier state cache naturally.
- See `docs/06-MULTIPLIER-GAMES.md` for the math notes.

## 4. Local Data Model (Dexie / IndexedDB)

Schema defined as Zod in `packages/shared` so a future server (Postgres/Drizzle) can mirror it 1:1. All IDs are UUIDv7 (time-sortable, sync-friendly). Every record has `updatedAt` and `deletedAt?` (tombstones, for future sync).

```
profile(id='local', displayName, createdAt, prefs)
aiSettings(id='local', visionProvider, visionModel, coachProvider, coachModel,
           heuristicsProvider, heuristicsModel, fallbackEnabled, rememberKeys:boolean)
aiKeys(provider[openai|anthropic], key)        -- web: IndexedDB (only if rememberKeys); iOS: Keychain
aiUsage(id, provider, model, task, inputTokens, outputTokens, estCost, createdAt)

gameFamilies (static asset)                     paytables(id /*hash*/, familyId, name, pays, source, createdAt)
analyses(key /*hash(family+valueVector)*/, paytableId, variantKind, variantStateKey,
         returnPct, variance, hitFreq, rankProbs, perHandBlob, strategyLists, engineVersion, computedAt)

machines(id, name, paytableId, variant{kind, config}, denominationCents, coins, lines,
         theme, speed, defaultWalletId, casinoName?, location?, notes?)
wallets(id, name, balanceCents, createdAt)
walletLedger(id, walletId, sessionId?, type[topup|transfer|bet|win|adjust], amountCents, balanceAfterCents, createdAt)

sessions(id, machineId, walletId, mode[free_play|drill|weakness|close_calls|ladder|switcher|exam|casino_log],
         status[active|paused|closed], state{hand, heldMask, phase, credits, variantState},
         startedAt, updatedAt, endedAt, summary)

decisions(id, sessionId, paytableId, analysisKey, variantKind, variantState,
          canonicalHandId, dealtCards, chosenMask, bestMask, chosenEv, bestEv, evLoss,
          chosenLabel, bestLabel, gapToSecond, decisionMs,
          handIndexInSession, msSinceSessionStart, priorOutcome, createdAt)
  -- indexes: [paytableId+bestLabel], [paytableId+bestLabel+chosenLabel], createdAt

categoryMastery([familyId+label], alpha, beta, lastSeenAt, fsrsStability, fsrsDifficulty, dueAt)
heuristicCards(id, paytableId, targetLabelPair, ruleAst, ruleText, mnemonic, exceptions,
               examples, costPct, status[active|mastered|archived], createdAt)
uploads(id, kind[paytable|hand], imageBlob?, extracted, confirmed, provider, model, createdAt, expiresAt)
scoutingLog(id, paytableId, casino, location, denominationCents, seenAt, notes)

-- Cruise rewards (full definitions in 07-CRUISE-REWARDS.md §6):
rewardsPrograms · trips · casinoSessions · rewardsReceived
-- sessions also gain: activeMs, handsPerHour, virtualCoinInCents, virtualPoints
```

**Data safety (no cloud in MVP):**
- Call `navigator.storage.persist()` on first run so the browser is less likely to evict data.
- **Export / Import backup** (single JSON file, optionally gzipped) in Settings. Exports exclude API keys.
- Gentle reminder to back up every ~500 decisions.
- `decisions` can grow large: keep raw rows for 90 days and roll older rows into daily aggregates per (paytable, label pair).

## 5. Local Service Layer

Instead of REST endpoints, the app talks to typed **service modules** (`apps/web/src/services/*`) with Zod-validated inputs/outputs. Contracts live in `packages/shared` so a future server can implement them unchanged.

```
paytableService: extractFromPhoto(image) · save(draft) · getAnalysis(id, variant?) · library(family?) · compare(a, b)
handService:     extractFromPhoto(image) · analyze(cards, paytableId, coins, variantState?) · explain(cards, paytableId, chosenMask?)
machineService / walletService (topup, transfer) / sessionService (start, pause, resume, close, applyAction)
decisionService: record(decision) · query(filters)
statsService:    overview(paytableId) · confusion(paytableId) · weaknesses() · context()
drillService:    next(mode, paytableId, count)  → hands with precomputed answers
heuristicService: generate(paytableId, labelPair) · validate(ruleAst)
strategyService: list(paytableId, tier) · printablePdf(paytableId, tier)
aiService:       settings get/set · testConnection(provider) · usage()
backupService:   export() · import(file)
rewardsService · tripService (rollups, planner) · casinoSessionService (timer, coin-in derivation) · rewardsLedgerService · riskService (result percentiles via simulation in the worker)
```

## 6. Mistake Intelligence Algorithms

**Per-category stats** for each `bestLabel` and confusion pair (`bestLabel → chosenLabel`): `n`, `errors`, `evLostTotal`, error rate as a Beta(1,1) posterior mean, recency-weighted with a 14-day half-life.

**Weakness score:**
```
weakness(label) = P(error | label)            // posterior, recency-weighted
                × avgEvLoss(label)             // coins per mistake
                × freqInRealPlay(label)        // from GameAnalysis perHand weights
                × confidenceFactor(n)          // down-weight tiny samples
```
That is the expected EV lost per hand dealt, by category, so the ranking equals money at stake.

**Effective return** = optimal return − EV lost per hand, re-weighted to the real-play hand distribution (drills over-sample hard hands). Show both "as drilled" and "real-play weighted".

**Context analysis:** bucketed error rates (or logistic regression) by decision time, hand index in session, recent pay table switch, prior outcome. Report only effects whose confidence interval excludes 0.

**Weakness Trainer mix:** 70% top-5 weakness pairs (sampled ∝ weakness), 20% FSRS-due review, 10% random real-distribution hands. A category leaves the focus queue at posterior error < 2% with n ≥ 30.

## 7. LLM Integration (bring your own key)

### 7.1 Keys & calls
- User enters their OpenAI and/or Anthropic API key in Settings. Nothing is ever sent to our servers (there are none).
- **Web:** key kept in memory for the session by default; if "Remember key on this device" is on, stored in IndexedDB. Show a plain warning: "Stored unencrypted in this browser. Anyone with access to this device/browser profile can read it." (Encrypting with a key stored next to it adds no real protection, so the app doesn't pretend to.)
- **iOS:** stored in the Keychain via a Capacitor secure-storage plugin.
- Calls go **directly from the client** to the provider:
  - Anthropic SDK with `dangerouslyAllowBrowser: true` (sends the `anthropic-dangerous-direct-browser-access` header that enables CORS).
  - OpenAI SDK with `dangerouslyAllowBrowser: true`.
  - These flags exist to warn against shipping *your own* key to browsers; with BYO keys, the key belongs to the person using the browser, which is the intended use.
- Strict Content-Security-Policy (`connect-src` limited to `api.openai.com`, `api.anthropic.com`, self), no third-party scripts, to reduce XSS risk to stored keys.
- No key entered → every AI feature shows "Add an API key in Settings to use this", and everything else works.

### 7.2 Provider abstraction (`apps/web/src/ai`)
```ts
interface LLMProvider {
  id: "openai" | "anthropic";
  vision<T>(a: { images: Blob[]; system: string; prompt: string; schema: ZodSchema<T>; model: string }): Promise<T>;
  text<T = string>(a: { system: string; prompt: string; schema?: ZodSchema<T>; model: string }): Promise<T>;
  test(): Promise<{ ok: boolean; error?: string }>;
}
```
- OpenAI: structured outputs (JSON schema). Anthropic: tool/JSON-schema definition for structured output.
- Model IDs are **config, not code**: defaults in one `models.ts`, user-overridable. Suggested defaults: Anthropic `claude-sonnet-5-5` (vision, coaching) and `claude-haiku-5-5` (cheap text); OpenAI: its current flagship vision model and its "mini" tier. Check the providers' docs for current IDs at build time.
- Router `getProvider(task)`: per-task provider choice, optional fallback to the other provider (only if that key exists), Zod validation with one retry, token/cost logging to `aiUsage`.

### 7.3 Tasks & prompts (all outputs schema-validated)

| Task | Input | Output schema | Guardrails |
|---|---|---|---|
| `paytable_extract` | photo(s) | `{familyGuess, variantGuess, rows:[{label, pays:[5]}], denomination?, lines?, confidence}` | Synonym dictionary → `HandRankId`; validation rules; user confirm. `variantGuess` flags Ultimate X etc. as "not yet supported". |
| `hand_extract` | photo | `{cards:[{rank,suit,position,confidence}], held:[bool×5]?, multipliers?}` | 5 distinct cards; confirm UI. |
| `explain_hand` | engine `HandAnalysis` JSON + strategy line | `{summary, why, commonMistake, tip}` | Prompt forbids new numbers; the client checks that every number in the output appears in the input. |
| `heuristic_generate` | weakness pair + 20 example hands + counterexamples + strategy lines | `{ruleAst, ruleText, mnemonic, exceptions[]}` | Engine scores `ruleAst`; up to 2 rewrite loops. |
| `coach_report` | aggregated stats JSON | `{headline, wins[], focus[], plan[]}` | Stats only. |

### 7.4 Image pipeline
On device: resize to ≤ 1600 px long edge, JPEG q≈0.8, strip EXIF → send directly to the vision model → draft → confirm grid. Keep the image locally only if the user opts in (default: discard after confirm). Cache extractions by image hash.

## 8. Client Architecture

- **State:** Zustand store per open session (`sessions[id]`) + `activeSessionId`; persisted to Dexie on every action.
- **Engine worker:** `engine.worker.ts` exposes `analyzeHand`, `analyzeGame` (with progress), `loadAnalysis(key)`, `generateDrill(...)` via Comlink.
- **Screens:** Home (machine carousel) · Play · Drill · Analyze (camera/manual) · Pay Tables (scan/library/compare) · Stats · Heuristics · Wallets · Settings (AI keys & providers, backup).
- **Session switcher:** persistent top bar with a chip per open session (machine name, credits, mode); tap to switch; `Ctrl+1..9` on web.
- **PWA:** service worker caches the app shell + precomputed analyses for offline use.

## 9. iOS (Phase 4, Capacitor)

- `npx cap add ios`; build in Xcode (needs a Mac or a cloud Mac CI; Replit can't run Xcode).
- Plugins: `@capacitor/camera`, `@capacitor/haptics`, `@capacitor/filesystem` (backup export/share), Keychain secure storage for API keys; SQLite if IndexedDB limits are a problem.
- AI calls: on native, use `CapacitorHttp` or the SDKs' fetch (no CORS issues on native).
- App Store: simulated gambling → mature age rating; no real money or purchasable coins; privacy label discloses that photos and hand data are sent to the AI provider *the user chooses, with their own key*.

## 10. Testing Strategy

- **Engine golden tests:** known returns (Product Spec F1.2); fast solver = naive solver on 1,000 random hands; known tricky hands (e.g. 9/6 JoB `Ah Kh Qh Jh Ts`: break the straight for 4RF; low pair vs 4FL; KQJ vs 3SF).
- **Value-vector test:** the solver with `V = pays[5]` and with a scaled vector `2·V` gives identical holds (guards the variant hook).
- **Labeler tests:** ~300 table-driven hands per family.
- **Strategy induction:** Expert list gap ≤ 0.02% for each library pay table.
- **Vision eval set:** 50 pay table + 50 hand photos with ground truth; a dev-only script runs both providers with your own key.
- **E2E (Playwright):** create machine → play 10 hands → switch session → stats update → export/import backup round-trip.
