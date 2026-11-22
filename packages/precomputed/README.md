# Precomputed library analyses

Run `pnpm precompute` from the repository root. This computes—not substitutes
reference values for—the exact optimal return, single-line variance, hit
frequency, payout probabilities, and all 134,459 weighted canonical hand rows
for every library pay table at five coins.

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

The app fetches static files from its own origin; nothing is calculated by a
server and no user data is sent anywhere. Loading or caching these indices in
the actual training screens is deferred to the later service/worker prompts.
