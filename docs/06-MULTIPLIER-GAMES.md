# Multiplier Games — Notes for Later

**Status:** not in MVP. The engine, data model and UI are built with hooks so these can be added without rework (Tech Spec §3.3 value vector, §3.9 `GameVariant`).

## The core idea that makes this possible

The EV solver never reads a pay table directly; it maximizes the expected **value vector** `V[rank]` over the 32 holds. Because every line in a multi-line game shares the same hold and each line draws independently, expected value is **linear across lines**, so any of these games collapses to *one* value vector per decision:

```
V(r) = Σ_lines  currentMultiplier_l × pay(r)  +  futureValue(r, state)
```

The 32-hold solver, the hold labeler, drills and mistake stats then work unchanged. What changes per game is how `V` and the next state are built.

## Per-game notes

### Ultimate X (3/5/10-play)
- Costs 2× coins per line. Each line's final hand awards a multiplier for **that line on the next hand** (multiplier table depends on game and line count; it must be data in `variant.config`, captured by photo or entered manually).
- `futureValue(r) = L × (awardedMult(r) − 1) × E1`, where `E1` = expected pay of one line on the next hand at 1× (approximate). Exact version: value iteration over multiplier states, since the next hand's strategy also depends on its multipliers. Start with the approximation, then refine and measure the difference.
- State: `lineMultipliers[]`. Distinct multiplier states are few and repeat, so cache an analysis per (value vector) key.
- Training implication: the same hand has *different correct holds* depending on current multipliers. Store `variantState` on every decision and add labels like "Ultimate X: held for multiplier" to the confusion matrix.

### Super Times Pay
- Costs extra (e.g. 6 coins instead of 5); a random multiplier is applied to the next win.
- If the multiplier odds don't depend on hand rank, `V` is just pay scaled uniformly and **the strategy is identical to the base game**; only return and variance change. If a variant's odds do depend on rank, use the expected multiplier per rank.

### Multi-Strike
- 4 levels (1×, 2×, 4×, 8×); a winning hand advances you to the next level.
- Backward induction: `E_4` = top-level value; `V_level(r) = mult_level × pay(r) + (r is a win ? E_{level+1} : 0)`. State = `level`. The "free ride" card is an extra state flag.

### Dream Card
- The hold decision uses the standard solver once the starting hand is known; only full-game analysis changes (different starting hand distribution). Low priority.

## Checklist for adding a variant
1. Add `VariantKind` + `config` schema in `packages/shared`.
2. Implement `valueVector`, `nextState`, `betCoins` in `packages/engine/variants/<kind>.ts`.
3. Golden test: return % vs a published value for one config (check two sources).
4. Machine editor: variant picker + config editor (multiplier table grid); photo extraction already returns `variantGuess`.
5. Play UI: show per-line multipliers, multi-hand display.
6. Stats: filter/split by `variantKind` and multiplier bucket.
