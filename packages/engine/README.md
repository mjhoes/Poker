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
- Every hold includes a deterministic `label`; workers and UI remain deferred.

## Enumeration and lookup

Evaluators lazily build a 2,598,960-byte table over all unordered five-card hands
in combinadic order. JoB/BPD and Bonus/DB share tables. Deuces table construction
also memoizes by natural rank multiset and suitedness; deuces are wild and a
natural royal is distinguished from a wild royal. Call `initializeEvaluator`
to warm a family, or `clearEvaluatorCache` to release the cached tables.

The naive solver enumerates all C(52,5) finals and buckets each by its intersection
with the original deal. This is equivalent to enumerating the undealt 47-card
deck separately for each of 32 holds, with exactly C(47,5-heldCount) outcomes per
hold. Discards cannot reappear.

## Fast solver and full-game analysis

`analyzeHandFast(cards, vector, familyId)` returns exactly the same shape/counts as
the naive oracle, but uses per-rank subset tables and a superset Möbius transform.
Sizes 0–4 are stored (about 11–16 MiB per distinct rank family); size 5 uses the
existing evaluator. Equivalent JoB/BPD and Bonus/DB rank tables share memory.
They are payout-independent. `clearSubsetCache()` releases them when switching
families; `subsetTableBytes(familyId)` reports working storage.

```ts
const full = analyzeGame(family.id, values, progress => {
  // initializing / analyzing / complete, with completed and total counts
}, { betCoins: 5 });
```

`getCanonicalHands()` contains exactly 134,459 suit-isomorphic classes with
integer orbit weights summing to C(52,5). Full analysis weights each class by
that multiplicity, not equally. `returnPct` is a percentage; `rankProbs` and
`hitFreq` are fractions. `variance` is the **single-line return variance per
unit bet**. Use `betCoins: 5` for total five-coin payout vectors. Variance is not
multiplay variance and does not include covariance between lines.

The `perHand` map uses numeric packed canonical IDs. Masks in this index refer
to the sorted canonical cards. Use `canonicalizeHand` and `restoreHoldMask`
when looking up a hand entered in some other suit/card order. Ties use ascending
mask order. EVs and second EVs remain in the supplied total-coin payout units.
Canonical rows include payout-independent best/second category labels.

## Labels, strategies, rule validation, and drills

`labelHold(cards, mask, familyId)` and `describeHold` are payout-independent.
The latter also returns held/discarded rank strings, wild count, high-card count,
and penalty-card counts for named royal/straight/flush draw patterns. For example, a discarded ten
while holding AKQJ is a straight penalty even if it is not the royal's suit.
Deuces labels carry the number of held wilds (`D1_ONLY`, `D0_3RF_h3`, etc.).
All labels and penalties are invariant under suit renaming and card reordering.
`bestLabel` and `secondLabel` are included in the canonical game index.
Three-card straight flushes use the standard convention: high cards ≥ gaps is
type 1 (including 456s and 789s), except 234s and ace-low holds are type 2;
two-gap draws without a high card (such as 975s) are type 3.
This follows the [Wizard of Odds convention](https://wizardofodds.com/games/video-poker/strategy/jacks-or-better/9-6/optimal/).
`describeLabel(label, familyId)` converts atomic, grouped, and refined labels
to plain English, including wild counts and penalty annotations.

Register a complete game analysis under its externally computed analysis key:

```ts
registerTrainingAnalysis(key, full);
const expert = generateStrategyList(key, "Expert");
const displayedHold = selectStrategyHold(analyzeHandFast(cards, values, family.id), expert);
```

Induction constructs frequency/EV-gap-weighted precedence evidence between the
best available holds per label, resolves cycles deterministically, and scores
the resulting policy over **every weighted canonical hand**. Contextual
exceptions are tested on all matching hands, not only their discovery examples.
Rank/penalty conflicts that remain inconsistent can be split by explicit
held/discarded suit relationships. No exception consults a canonical-ID answer
table or silently falls back to optimal play.

- **Beginner:** at most 15 greedily selected lines from level-0 labels, including
  DRAW5. Related labels may share a printed line, with their explicit ordered
  `alternatives` retained. The first applicable subrule wins; there is no
  best-EV choice across a group and no coarse level-2 category bucket.
- **Intermediate:** the unrefined category ordering, without penalty modifiers.
- **Expert:** at most 60 lines and 15 exceptions. Begin with level-0 rules,
  improve their order by replayed return, then greedily add only cost-reducing
  penalty-card refinements. Each penalty-specific line counts as both one
  printed line and one exception. No held/discarded-rank or suit templates.
- **Reference:** the former detailed Expert policy, retained for internal
  validation only. It may use explicit rank/penalty/suit relationships and is
  not a chart to memorize (`forMemorization: false`).
- **Perfect:** explicitly uses the engine optimum, not a memorization list.

All tiers report their actual return and simplification cost. Matching holds
within a label use the best EV, as the technical specification requires.
Every chart is measured by replaying its own rules over all weighted deals,
never by substituting perfect-play return. Bounded charts undergo greedy
insertion and return-increasing local reordering; this is not a claim of a
globally minimal chart. Per-line frequencies use the real-deal weights.
`costIfIgnored` is the signed change in percentage points from omitting that
whole printed line (including all ordered subrules); a penalty-specific line's
generic match remains available when it is omitted. It is `null` for the indispensable DRAW5
fallback. Strategy selection rejects a hand analyzed under another payout vector.

Generation does **not** throw for a missed accuracy target: the returned list
has its real gap and `meetsTarget: false`. The gap targets are 0.15 percentage
points for Beginner and 0.03 for Expert; Reference uses 0.02 plus ≥99.9% optimal
decisions. `scripts/precompute.ts` alone enforces required library build gates:
Beginner/Expert on 9/6 JoB, and Reference on every library table. Other tables'
bounded-chart gaps and target flags are reported honestly, even when they miss.
Use `MEMORIZABLE_STRATEGY_TIERS` or `forMemorization` in chart-selection UIs,
not the full five-tier internal enumeration.

The full 9/6 JoB tier snapshot is in `tests/__snapshots__/training.test.ts.snap`.
Actual gaps for every tier/table are in
`../precomputed/tests/__snapshots__/strategy-library.test.ts.snap`.

```ts
const result = evaluateRule({
  kind: "prefer",
  prefer: { label: "LP" },
  over: { label: "4FL" },
  unless: { kind: "rank", rank: "2", in: "held" },
}, key);
```

The JSON AST supports exact/base/prefix label selectors, optional held ranks,
flush/straight penalty conditions, held/discarded ranks, AND/OR, and NOT.
Unknown syntax/labels, excessive nesting, and cycles are rejected. A rule is a
**local precedence rewrite**: apply it where the best available preferred or
overridden hold is optimal; leave unrelated higher plays alone. Outside the
rule's applicability/exception region, play remains optimal. The returned cost
is this partial rule's exact all-deal cost, not the cost of combining it with
other untested rules. Reports include weighted and canonical applicability
counts, percentage-point return loss, and engine-checked counterexamples.

```ts
const drill = generateHand({
  analysisKey: key,
  targetPairs: [{ correct: "4FL", confusedWith: "LP" }],
  closeCallMaxGap: 0.1,
  excludeRecent: recentCanonicalIds,
});
```

The drill index uses optimal/second labels, exact or unmodified base categories.
Both requested pair members, the inclusive EV-gap limit, and recent exclusions
must hold; unsatisfiable requests throw, never silently switch to random hands.
Default sampling weights suit classes by real frequency; `sampling: "canonical"`
is an explicit uniform-class alternative. Suit and card-order randomization
remaps both returned masks to the displayed cards. An injectable `random` source
allows repeatable tests; randomness affects training samples, never EV math.

Training datasets and optimizer columns are lazy and can consume hundreds of MiB. Call
`clearTrainingCache(key)` after batch processing, and run induction/scoring in
the worker when the UI service layer is implemented.

Initialization and analysis are synchronous; run them in a Web Worker when
the client integration is added. This package itself imports no worker APIs.

Run `pnpm test` at the repository root, or `pnpm --filter @perfect-draw/engine test`.
