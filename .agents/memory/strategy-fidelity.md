---
name: Strategy fidelity
description: Why derived strategy tiers need explicit contextual exceptions and independent all-deal scoring.
---

Expert strategies must remain explicit label-priority policies with inspectable
rank, penalty, and (when necessary) suit-relationship exceptions. Do not repair
a failing chart by consulting canonical-hand answers at selection time or by
silently using the optimal engine hold. Perfect is the separate engine tier.

**Why:** Rank and simple penalty categories can still have conflicting precedence
because discarded-card suit relationships matter. A chart can appear accurate
while failing on those contexts; measuring a hidden optimal fallback would make
the chart's reported return meaningless.

**How to apply:** When modifying induction or simplifying a tier, replay the
actual policy across all canonical deals with multiplicity weights. Refine
explicit conditions or report the measured loss; do not substitute the optimum.
