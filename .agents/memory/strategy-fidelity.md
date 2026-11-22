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
not as a chart to memorize. Full-deal rank/discard/suit templates belong to
Reference; rank-aware hold categories are level-0 rules where payouts depend
on rank. Memorizable charts use these explicit rules and measured penalty
refinements.

**Why:** The user asked for genuinely memorizable charts rather than a large
near-perfect reference presented as Expert. A hidden optimal fallback would also
make a chart's reported return meaningless.

**How to apply:** When modifying induction or simplifying a tier, replay the
actual policy across all canonical deals with multiplicity weights. Report
actual gaps and missed-target flags instead of hiding misses or substituting
the optimum. Keep ordered grouped subrules explicit rather than selecting
their best EV invisibly.

Same-label holds must use deterministic, human-followable visible-card tie
rules, not highest EV. Unnamed holds must not become chart rules; the unmatched
choice is discard five.

**Why:** The user explicitly required the chart, including its tie choices, to
be reproducible without consulting an optimal solver.

**How to apply:** Optimize rule order using engine EVs during induction, but
never compare EVs while playing a chart line. Keep the tie policy suit-equivariant
(identical suit patterns may be interchangeable), because weighted canonical
replay assumes that suit renaming does not change a policy's EV.

Do not impose a universal made-hand ranking when grouping chart rules.

**Why:** Paytable-specific draws can outrank made hands; in Deuces, four to a
natural Royal can beat a made natural Straight Flush.

**How to apply:** Preserve the learned, printed subrule order inside a group
and measure the complete policy after regrouping.
