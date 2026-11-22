---
name: Statistics semantics
description: Why analytics use canonical categories, exact coin baselines and explicit unknown coverage.
---

## Canonical categories versus original-order labels

Use a decision's canonical hand to select its optimal category for the statistics
partition. Preserve its originally logged labels for historical feedback.

**Why:** Equivalent optimal holds can have different category labels when input
positions change: the solver's mask tie order is positional. The full-game
frequency distribution is canonical, so grouping original-order labels directly
can give inconsistent categories and frequencies without any actual play error.

**How to apply:** Analytics, future daily aggregation and real-play weighting must
use the same canonical partition. A label mismatch alone is not an error; use
engine EV loss and tie tolerance. Never rewrite historical decisions to make
their labels match the partition.

## Missing coverage is unknown cost

Do not assume unobserved categories were played perfectly. A full real-play
return estimate requires category observations; incomplete coverage can expose an
explicit optimistic covered-cost ceiling, not an unqualified forecast.

**Why:** Drills intentionally bias the sample. Renormalizing away missing
categories or silently assigning zero loss would give a misleading full-game
number. A coverage ceiling is also not a statistical confidence bound.

**How to apply:** Show coverage and missing samples with estimates. Downstream
planning must preserve these qualifications rather than silently converting an
unknown return into the engine-perfect baseline.

## Exact bet baseline

Keep paytables and coin counts separate when estimating error cost and return.

**Why:** The five-coin royal bonus makes short-coin return nonlinear; scaling a
five-coin result is not a valid short-coin baseline.

**How to apply:** Use each saved configuration's actual value vector and bet for
analysis. Per-line bet-normalized error metrics are not wallet profit. Continue
to exclude assisted corrections as described in practice-integrity.md.
