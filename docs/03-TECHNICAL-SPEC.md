# Technical Spec

## 1. Stack (built for Replit, web first → iOS)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for engine, web, server and iOS shell. |
| Monorepo | pnpm workspaces | `packages/engine` shared by web, server and iOS. |
| Web client | **React 18 + Vite + Tailwind + Zustand + TanStack Query** | Fast on Replit, PWA-capable. |
| Offline store | IndexedDB via Dexie | Sessions/decisions offline; sync queue. |
| Heavy math | Web Worker (client) + Node worker_threads (server); optional **Rust→WASM** speed-up later | Keeps UI at 60 fps. |
| Server | **Node + Fastify** (or Express) | Simple REST + LLM proxy. |
| DB | **Replit PostgreSQL (Neon) + Drizzle ORM** | Built into Replit. |
| File storage | **Replit Object Storage** | Photos. |
| Auth | Replit Auth (or Clerk/Lucia if moving off Replit) | |
| Secrets | Replit Secrets: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `KEY_ENCRYPTION_SECRET`, `DATABASE_URL` | |
| Deploy | Replit Deployments (Autoscale for API + static web) | |
| iOS | **Capacitor** wrapping the same web build; native Camera, Haptics, Preferences plugins | Reuses ~100% of the UI. |
| Tests | Vitest (engine/unit), Playwright (e2e) | |

### Repo layout
```
/apps
  /web            React app (PWA)
  /server         Fastify API, LLM gateway, analysis jobs
  /ios            Capacitor project (phase 4)
/packages
  /engine         Pure TS: cards, evaluator, EV solver, strategy, labeling
  /shared         Zod schemas & types shared by client/server
  /paytables      JSON library of known pay tables + game family defs
/docs
```

## 2. Domain Model: Games & Pay Tables

### 2.1 Game family (data-driven)
```ts
type GameFamily = {
  id: string;                 // "jacks_or_better", "deuces_wild", "joker_poker_kings"
  deck: { size: 52 | 53; jokers: 0 | 1 };
  wilds: "none" | "deuces" | "joker";
  handRanks: HandRankId[];    // ordered best → worst for this family
  rankRules?: {               // e.g. quad sub-classes in bonus games
    quadKickers?: boolean;    // DDB/TDB "4 Aces w/ 2-4"
    minPair?: "J" | "T" | "K";
  };
};
```
`HandRankId` examples: `ROYAL_FLUSH`, `NATURAL_ROYAL`, `FOUR_DEUCES`, `WILD_ROYAL`, `FIVE_KIND`, `STRAIGHT_FLUSH`, `FOUR_ACES_W_234`, `FOUR_234_W_A234`, `FOUR_ACES`, `FOUR_234`, `FOUR_5K`, `FULL_HOUSE`, `FLUSH`, `STRAIGHT`, `THREE_KIND`, `TWO_PAIR`, `JACKS_OR_BETTER`, …

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
Strategy uses the per-coin pay at the chosen bet (the royal flush is usually 250/coin at 1–4 coins and 800/coin at max coin).

## 3. Engine (`packages/engine`)

### 3.1 Card representation
- Card = integer 0–51 (`rank*4 + suit`), 52 = joker.
- Hand = sorted 5-int array; also a 52-bit mask (BigInt or two 32-bit ints) for set operations.

### 3.2 Hand evaluator
- Non-wild: precomputed lookup table over all C(52,5)=2,598,960 hands → family-specific `HandRankId` index (built at startup in ~1 s, or loaded as a compact binary). Alternative: rank-pattern + flush-flag perfect hash (Cactus Kev style), then map to family ranks.
- Wild games: evaluate (natural cards, wild count) via a precomputed table keyed by the natural-card rank pattern + suitedness + wild count.

### 3.3 EV solver for one hand (all 32 holds)
For each hold mask `h` (32 subsets), draw `k = 5 − |h|` from the 47 remaining cards:
EV(h) = Σ over all C(47,k) draws of pay(final hand) / C(47,k).

- **Naive** total: ~2.6M evaluations per hand. Fine in a worker with a lookup evaluator (~100–300 ms in JS; ~10–30 ms in WASM).
- **Fast method** (needed for full-game analysis): precompute, for the whole deck, a table `T[S][payline]` = the number of 5-card hands that contain subset S, for every subset S of size 0–5, grouped by payline. For a given deal, count the draws that **exclude the 5 − |h| discarded cards** using inclusion–exclusion over the subsets of the discards. This gives all 32 EVs with ~a few hundred hash lookups per hand.
  - Implementation note: key subsets by sorted card tuple → 64-bit integer; store in a `Map` or perfect-hash arrays. Memory: ~3.2M entries for |S|≤4 plus 2.6M for |S|=5.
- Return type:
```ts
type HoldResult = { mask: number; ev: number; label: CategoryLabel; payoutDist: number[] };
type HandAnalysis = { hand: Card[]; results: HoldResult[] /* sorted desc */; best: HoldResult; gapToSecond: number };
```

### 3.4 Full-game analysis
- Enumerate the 134,459 **suit-isomorphic** canonical starting hands (with a multiplicity weight each) instead of all 2,598,960.
- For each: solve all 32 holds, pick the max EV, accumulate return, variance, and the frequency of each payline.
- Output `GameAnalysis { returnPct, variance, hitFreq, paylineProbs, perHand: Map<canonicalHandId, {bestMask, ev, secondEv, bestLabel, secondLabel}> }`.
- `perHand` (~134k rows) is **the core training index** (drill generation, strategy induction). Store it compressed (≈2–3 MB) in Postgres `bytea` / Object Storage, keyed by pay table hash; ship it to the client on demand and cache it in IndexedDB.
- Runs as a server job (worker_threads); target < 30 s in TS, < 5 s with WASM.

### 3.5 Hold-pattern labeling (the vocabulary)
A deterministic function `label(heldCards, fullHand, family) → CategoryLabel` produces strings such as:

| Group | Labels (non-wild examples) |
|---|---|
| Made hands | `RF`, `SF`, `4K`, `FH`, `FL`, `ST`, `3K`, `2P`, `HP` (high pair), `LP` (low pair) |
| 4-card draws | `4RF`, `4SF_open`, `4SF_inside`, `4FL`, `4ST_open_hN`, `4ST_inside_hN` (N = # high cards) |
| 3-card draws | `3RF_hN`, `3SF_t1|t2|t3` (type by gaps/high cards), `KQJ_unsuited`, `3FL_hN` (rare) |
| 2-card | `2RF_AK` … `2RF_JT`, `2SH_suited` (suited high cards), `2H_unsuited` (e.g. `QJ`, `KQ`), `AK_unsuited`… |
| 1-card | `1H_A`, `1H_K` … |
| Nothing | `DRAW5` |

Wild families use a separate vocabulary keyed on the number of wilds held (`D2_4K`, `D1_4SF`, `D0_3RF`, …).
Penalty modifiers attach as suffixes (`2RF_QJ|pen:flush`, `|pen:straight`), computed by checking for discards that reduce the hold's flush or straight outs.

### 3.6 Strategy list induction
1. From `perHand`, for each canonical hand gather `{labels present (best hold per label), optimal label}`.
2. Build a pairwise precedence graph: edge A→B weighted by how often A beats B when both are present (weighted by hand frequency).
3. Topologically sort; where precedence is inconsistent (A>B sometimes, B>A others), try splitting the label with penalty-card or high-card modifiers until consistency is ≥ 99.9% (by frequency).
4. Score the list by "playing" it over all canonical hands → `listReturnPct`. Tiers:
   - **Perfect**: engine EV (no list).
   - **Expert**: full induced list (target gap ≤ 0.02%).
   - **Intermediate**: merge adjacent low-frequency lines/drop penalty refinements.
   - **Beginner**: ≤ 12 lines, greedily chosen to minimize cost.
5. Store as `StrategyList { tier, lines: [{label, rank, exceptions[], freq, costIfIgnored}], returnPct }`.

### 3.7 Heuristic validator
`evaluateRule(rule: RuleAST, payTable) → { returnPct, costVsOptimal, handsAffected, counterexamples[] }`.
Rules are small ASTs ("prefer label A over B unless penalty P") that the LLM proposes as **JSON**; the engine scores them. Rules that cost > a threshold get rejected or rewritten.

### 3.8 Drill hand generator
`generateHand({ payTableId, targetPairs: [{correct: Label, confusedWith: Label}], closeCallMaxGap?, excludeRecent })`
- Pre-index `perHand` by (bestLabel, secondLabel) → list of canonical hand IDs.
- Sample a canonical hand, then apply a random suit permutation + card order shuffle so drills don't look repetitive.

## 4. Data Model (Postgres / Drizzle)

```
users(id, email, created_at, settings_json)
ai_provider_keys(id, user_id, provider[openai|anthropic], encrypted_key, created_at)
ai_settings(user_id, vision_provider, vision_model, coach_provider, coach_model,
            heuristics_provider, heuristics_model, fallback_enabled, key_source[app|byo])
ai_usage(id, user_id, provider, model, task, input_tokens, output_tokens, est_cost, created_at)

game_families(id, def_json)
paytables(id /*hash*/, family_id, name, pays_json, source, created_by, created_at)
paytable_analyses(paytable_id, return_pct, variance, hit_freq, payline_probs_json,
                  per_hand_blob_url, strategy_lists_json, computed_at, engine_version)

machines(id, user_id, name, paytable_id, denomination_cents, coins, lines, theme, speed,
         casino_name?, location?, notes?)
wallets(id, user_id, name, balance_cents, created_at)
machine_wallets(machine_id, wallet_id)             -- default wallet per machine
wallet_ledger(id, wallet_id, session_id?, type[topup|transfer|bet|win|adjust],
              amount_cents, balance_after_cents, created_at)

sessions(id, user_id, machine_id, wallet_id, mode[free_play|drill|weakness|close_calls|ladder|switcher|exam|casino_log],
         status[active|paused|closed], state_json /* current hand, held mask, credits */,
         started_at, updated_at, ended_at, summary_json)

decisions(id, user_id, session_id, paytable_id, canonical_hand_id, dealt_cards,
          chosen_mask, best_mask, chosen_ev, best_ev, ev_loss,
          chosen_label, best_label, gap_to_second, decision_ms,
          hand_index_in_session, ms_since_session_start, prior_outcome, created_at)
  -- index (user_id, paytable_id, best_label, chosen_label)

category_mastery(user_id, family_id, label, alpha, beta, last_seen_at,
                 fsrs_stability, fsrs_difficulty, due_at)
heuristic_cards(id, user_id, paytable_id, target_label_pair, rule_ast_json,
                rule_text, mnemonic, exceptions_json, examples_json, cost_pct,
                status[active|mastered|archived], created_at)
uploads(id, user_id, kind[paytable|hand], object_key, extracted_json, confirmed_json,
        provider, model, created_at, expires_at)
scouting_log(id, user_id, paytable_id, casino, location, denomination_cents, seen_at, notes)
```

## 5. API (REST, JSON, Zod-validated)

```
POST /api/paytables/extract          multipart image → {draft PayTable, confidence, issues[]}
POST /api/paytables                   confirmed pay table → {paytable, analysisStatus}
GET  /api/paytables/:id/analysis      → GameAnalysis summary + strategy lists
GET  /api/paytables/:id/per-hand      → compressed perHand blob (CDN-cacheable)
GET  /api/paytables/library?family=   → known tables

POST /api/hands/extract               multipart image → {cards[], held[], confidence}
POST /api/hands/analyze               {cards, paytableId, coins} → HandAnalysis (server fallback; client normally solves locally)
POST /api/hands/explain               {cards, paytableId, chosenMask?} → {explanation} (LLM, grounded)

CRUD /api/machines, /api/wallets, /api/sessions
POST /api/wallets/:id/topup | /transfer
POST /api/sessions/:id/decisions      batch upload (offline sync)
GET  /api/stats/overview?paytableId=  → accuracy, evLostPer1000, effectiveReturn
GET  /api/stats/confusion?paytableId= → matrix
GET  /api/stats/weaknesses            → ranked list
POST /api/drills/next                 {mode, paytableId, count} → hands[] with precomputed answers
POST /api/heuristics/generate         {paytableId, labelPair} → HeuristicCard (LLM + engine validation)
POST /api/heuristics/validate         {ruleAst} → cost report
GET  /api/strategy/:paytableId/pdf?tier=

GET/PUT /api/settings/ai ; POST /api/settings/ai/test
```

## 6. Mistake Intelligence Algorithms

**Per-category stats** for each (bestLabel) and confusion pair (bestLabel → chosenLabel):
- `n`, `errors`, `evLostTotal`, `errorRate` (Beta(1,1) posterior mean), recency-weighted with a 14-day half-life.

**Weakness score** (rank what to train):
```
weakness(label) = P(error | label)            // posterior, recency-weighted
                × avgEvLoss(label)             // coins per mistake
                × freqInRealPlay(label)        // from GameAnalysis perHand weights
                × confidenceFactor(n)          // down-weight tiny samples
```
This is "expected EV lost per hand dealt" by category, so the ranking equals money at stake.

**Effective return** = optimal return − (Σ evLoss / Σ hands, scaled to the real-play distribution). Shown both "as drilled" and "re-weighted to real play" (drills over-sample hard hands, so a raw average would overstate losses).

**Context analysis**: logistic regression (or simple bucketed rates) of error ~ decision_ms bucket + hand_index bucket + post-switch flag + prior_outcome. Report only effects with clear significance (e.g. p < 0.05 / CI excludes 0) to avoid noise.

**Weakness Trainer mix**: 70% top-5 weakness pairs (sampled ∝ weakness), 20% FSRS-due review, 10% random real-distribution hands. A category leaves the focus queue at posterior error rate < 2% with n ≥ 30.

## 7. LLM Integration

### 7.1 Provider abstraction (`apps/server/src/ai`)
```ts
interface LLMProvider {
  id: "openai" | "anthropic";
  vision<T>(args: { images: Buffer[]; system: string; prompt: string; schema: ZodSchema<T>; model: string }): Promise<T>;
  text<T = string>(args: { system: string; prompt: string; schema?: ZodSchema<T>; model: string }): Promise<T>;
}
```
- `OpenAIProvider` uses the official `openai` SDK with structured outputs (JSON schema).
- `AnthropicProvider` uses the official `@anthropic-ai/sdk`; structured output via a tool/JSON-schema definition.
- Model IDs are **config, not code** (`ai_settings`), with defaults kept in one `models.ts`. Suggested defaults: Anthropic `claude-sonnet-5-5` for vision/coaching, `claude-haiku-5-5` for cheap high-volume text; OpenAI: its current flagship vision model and a "mini" tier. Check the providers' docs for current IDs at build time.
- Router: `getProvider(task, user)` → applies key source (BYO decrypted with `KEY_ENCRYPTION_SECRET` vs app key), fallback, logging to `ai_usage`, and response validation (Zod). Retry once with the other provider on schema failure if fallback is enabled.

### 7.2 Tasks & prompts (all outputs schema-validated)

| Task | Input | Output schema | Guardrails |
|---|---|---|---|
| `paytable_extract` | photo(s) | `{familyGuess, rows:[{label, pays:[5]}], denomination?, lines?, confidence:{…}}` | Map labels via synonym dictionary → `HandRankId`; validation rules; user confirm. |
| `hand_extract` | photo | `{cards:[{rank,suit,position,confidence}], held:[bool×5]?}` | Must be 5 distinct cards (or joker); confirm UI. |
| `explain_hand` | engine `HandAnalysis` JSON + strategy line | `{summary, why, commonMistake, tip}` | Prompt forbids new numbers; the server checks that every number in the output appears in the input. |
| `heuristic_generate` | weakness pair + 20 example hands + counterexamples + strategy lines | `{ruleAst, ruleText, mnemonic, exceptions[]}` | Engine scores `ruleAst`; up to 2 rewrite loops if cost > threshold. |
| `coach_report` | aggregated stats JSON | `{headline, wins[], focus[], plan[]}` | Stats only, no raw hands needed. |

### 7.3 Image pipeline
Client resizes to ≤ 1600 px long edge, JPEG q≈0.8, strips EXIF → upload to Object Storage → server sends to the vision model → draft → client confirm grid. For pay tables, optionally ask for 2 photos (glare). Cache extraction by image hash.

## 8. Client Architecture

- **State**: Zustand stores per open session (`sessions[id]`), with a `activeSessionId`; persisted to IndexedDB on every action.
- **Engine worker**: `engine.worker.ts` exposes `analyzeHand`, `loadPerHand(paytableId)`, `generateDrill(...)` via Comlink.
- **Sync**: decisions queued locally → batched POST every 20 decisions / 30 s / on visibility change.
- **Screens**: Home (machine carousel) · Play (machine UI) · Drill · Analyze (camera/manual) · Pay Tables (scan/library/compare) · Stats · Heuristics · Wallets · Settings (AI providers).
- **Session switcher**: persistent top bar with chips per open session (machine name, credits, mode); swipe/tap to switch; `Ctrl+1..9` on web.

## 9. iOS (Phase 4)

- `npx cap add ios`; build in Xcode (requires a Mac or a cloud Mac CI such as Codemagic/EAS-equivalent; Replit can't run Xcode).
- Plugins: `@capacitor/camera` (pay table/hand capture), `@capacitor/haptics`, `@capacitor/preferences`, `@capacitor/filesystem`.
- Replace IndexedDB with SQLite (`@capacitor-community/sqlite`) if storage limits are a problem.
- App Store: simulated gambling → mature age rating; no real-money or purchasable coins; disclose AI data use (photos sent to OpenAI/Anthropic) in the privacy nutrition label.

## 10. Testing Strategy

- **Engine golden tests**: known returns (Product Spec F1.2), randomized brute force vs fast solver equality, known tricky hands (e.g. 9/6 JoB: `Ah Kh Qh Jh Ts`-type edge cases, 4RF vs made flush, low pair vs 4FL, KQJ vs 3SF…).
- **Labeler tests**: table-driven expected labels for ~300 hands per family.
- **Strategy induction tests**: Expert list gap ≤ 0.02% for each library pay table.
- **Vision eval set**: 50 pay table + 50 hand photos with ground truth, run on both providers; track accuracy in CI (manual trigger, costs money).
- **E2E**: Playwright: create machine → play 10 hands → switch session → stats update.
