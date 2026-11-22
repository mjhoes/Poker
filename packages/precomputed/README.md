# Precomputed library analyses

Run `pnpm precompute` from the repository root. This computes—not substitutes
reference values for—the exact optimal return, single-line variance, hit
frequency, payout probabilities, and all 134,459 weighted canonical hand rows
for every library pay table at five coins. The payload also includes best/second
category labels, the three measured memorization tiers, the internal Reference
policy, and the Perfect engine baseline.

The eight gzip payloads and manifest are written to `assets/` and copied to
`apps/web/public/analyses/`; `pnpm build` regenerates and includes them in the
static build. Generated files are not committed. `pnpm precompute:check`
verifies payload hashes, schemas, weights, and golden-return tolerances.

```ts
import { loadPrecomputedManifest, loadPrecomputedAnalysis } from "@perfect-draw/precomputed";

const manifest = await loadPrecomputedManifest(); // small summary, no hand indices
const job = await loadPrecomputedAnalysis("jacks-or-better-9-6", manifest);
```

Payloads use `.bin` rather than `.gz` to avoid static hosts interpreting the
file as transport-level gzip (which browsers may decompress before hash checks).
The file's contents are gzip-compressed JSON; the loader uses
`DecompressionStream("gzip")` and fails explicitly if unavailable. Filenames
include the SHA-256 analysis key (family + vector + normalization + engine
version); the manifest separately records the compressed payload's SHA-256.

The current payload schema is version 4 and the engine identity is 4.0.0.
Old payloads are rejected explicitly: regenerate them with `pnpm precompute`.
Strategy validation checks all five tiers, matching analysis keys and families,
the 15-line Beginner / 60-line Expert limits (20 / 75 for Deuces), and the
15-exception Expert limit. Accurate
`meetsTarget: false` payloads are valid; the loader never upgrades them to
perfect play or rejects them merely for missing a target.

The precompute script enforces Expert ≤0.03 percentage points on every library
table. Beginner must be within 0.15 pp for JoB, Bonus, and BPD, or 0.35 pp for
Double Bonus, DDB, and Deuces. Reference is also validated on every library table.
Library snapshots report actual gaps and target flags for all eight tables.
Descriptions are tested for every label used by their charts and Reference
policies. Only the first three tiers are for memorization.

Unnamed `OTHER_n` patterns are diagnostic only and cannot be chart lines. If no
named rule matches, the policy discards all five. Within a named rule, choices
use visible-card penalty counts, held-card count, ranks, and suit patterns, never
EV. Grouped alternatives remain explicitly ordered. Deuces charts include five
ordered sections by deuces held: 4, 3, 2, 1, 0; `formatStrategyChart` prints them.

The app fetches static files from its own origin; nothing is calculated by a
server and no user data is sent anywhere. Loading or caching these indices in
the actual training screens is deferred to the later service/worker prompts.
