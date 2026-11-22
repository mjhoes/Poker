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

Do not assume unobserved categories were played perfectly. Keep the existing
complete-category return field and optimistic covered-cost ceiling unchanged.
Also expose a separately labeled real-play weighted **estimate** once observed
categories cover at least 99% of real-play frequency (a named engine constant).
Impute unseen frequency using pooled recency-weighted EV loss per observed
decision in the exact scope, never zero, and display the filled frequency share.

**Why:** Drills intentionally bias the sample. Renormalizing away missing
categories or silently assigning zero loss would give a misleading full-game
number. A coverage ceiling is also not a statistical confidence bound.

**How to apply:** Add estimate fields rather than repurposing complete-coverage
fields. Below the threshold the new estimate is unknown. Downstream planning must
preserve coverage and imputation qualifications rather than silently converting
an unknown return into the engine-perfect baseline.

## Local days and retained history

Pass the user's IANA timezone explicitly. Date filters use actual local-day
bounds, including DST; trend timestamps are UTC-normalized calendar-date
coordinates for presentation, not claims about when local midnight occurred.

After 90 days, replace raw decisions atomically with canonical local-day
aggregates. Retain separate mode, coin count, engine-analysis key and timezone
dimensions. Preserve corrections as an excluded count, not primary observations.
Store weighted sufficient inputs relative to UTC midnight of the local date.

**Why:** A single offset cannot describe a DST transition. Daily counts alone
cannot reproduce within-day recency weights. Separating modes and analysis keys
prevents retrospective mixing of incompatible data. Partial failure must never
delete history without its aggregate.

**How to apply:** Keep the 14-day weighting convention consistent; changing it
requires an explicit aggregate migration policy, not just editing a constant.
Historical aggregates retain the local date/timezone used at rollup. An exact
partial-day query cannot be reconstructed after compaction: reject it explicitly
instead of prorating counts. Keep pending hands' original grade in saved round
state before deleting their original decision, so later settlement remains safe.
Backup counters include archived primary and correction counts.

## Exact bet baseline

Keep paytables and coin counts separate when estimating error cost and return.

**Why:** The five-coin royal bonus makes short-coin return nonlinear; scaling a
five-coin result is not a valid short-coin baseline.

**How to apply:** Use each saved configuration's actual value vector and bet for
analysis. Per-line bet-normalized error metrics are not wallet profit. Continue
to exclude assisted corrections as described in practice-integrity.md.
