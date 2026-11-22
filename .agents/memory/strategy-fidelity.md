---
name: Strategy fidelity
description: Why derived strategy tiers need explicit contextual exceptions and independent all-deal scoring.
---

Every chart's return must be measured by replaying the chart itself, never
perfect play. Do not repair a failing chart by consulting canonical-hand answers
at selection time or by silently using the optimal engine hold. Perfect is the
separate engine baseline, not a memorization chart.

The user explicitly separated memorizable Expert charts from the old detailed
strategy, now called Reference. Keep Reference for internal use and validation,
not as a chart to memorize. Rank/discard/suit templates belong to Reference;
memorizable charts use explicit level-0 rules and measured penalty refinements.

**Why:** The user asked for genuinely memorizable charts rather than a large
near-perfect reference presented as Expert. A hidden optimal fallback would also
make a chart's reported return meaningless.

**How to apply:** When modifying induction or simplifying a tier, replay the
actual policy across all canonical deals with multiplicity weights. Report
actual gaps and missed-target flags instead of hiding misses or substituting
the optimum. Keep ordered grouped subrules explicit rather than selecting
their best EV invisibly.
