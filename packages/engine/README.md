# Deterministic video poker engine

Pure TypeScript, with no runtime dependencies, DOM, Node APIs, network, or AI.

```ts
import { analyzeHand, parseHand, GAME_FAMILIES } from "@perfect-draw/engine";

const family = GAME_FAMILIES.jacks_or_better;
// In family.handRanks order, total returned coins on a five-coin 9/6 bet:
const values = [4000, 250, 125, 45, 30, 20, 15, 10, 5, 0];
const analysis = analyzeHand(parseHand("Ah Kh Qh Jh Ts"), values, family.id);
```

## Contracts

- Ranks run `2..A`, suits `c,d,h,s`: integer `rank * 4 + suit`.
- Joker `52` is reserved, but rejected in launch games.
- `parseHand` preserves order. `sortedHand` returns a sorted copy. Hold bit `i`
  always refers to input position `i`, not sorted position.
- Vectors are indexed by the selected family's `handRanks`, including explicit
  zero-valued `NOTHING`. Pass the family ID for non-JoB games. Full-pay Deuces
  and NSUD use the same evaluator and different vectors.
- Payouts and EVs are **total returned coins**, not net profit or per-coin return.
  `standardVariant.valueVector` selects the exact coin column; it does not divide
  by the bet, and preserves the max-coin royal bonus.
- Each result contains integer `rankCounts`, their sum `drawCount`, normalized
  `rankDist`, and EV. The counts are exact; division uses JS floating-point.
- All 32 holds are returned, ordered by descending EV, then ascending mask for
  exact ties. A tied mask ordering is not a unique strategy recommendation.
- Category labels, full-game analysis, pay-table library, workers, and UI are
  intentionally outside Prompt 2.

## Enumeration and lookup

Evaluators lazily build a 2,598,960-byte table over all unordered five-card hands
in combinadic order. JoB/BPD and Bonus/DB share tables. Deuces table construction
also memoizes by natural rank multiset and suitedness; deuces are wild and a
natural royal is distinguished from a wild royal. Call `initializeEvaluator`
to warm a family, or `clearEvaluatorCache` to release the cached tables.

The naive solver enumerates all C(52,5) finals and buckets each by its intersection
with the original deal. This is equivalent to enumerating the undealt 47-card
deck separately for each of 32 holds, with exactly C(47,5-heldCount) outcomes per
hold. Discards cannot reappear. It is not the fast subset solver from Prompt 3.

Initialization and enumeration are synchronous; run them in a Web Worker when
the client integration is added. This package itself imports no worker APIs.

Run `pnpm test` at the repository root, or `pnpm --filter @perfect-draw/engine test`.
