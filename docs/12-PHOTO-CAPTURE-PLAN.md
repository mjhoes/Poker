# Photo capture — plan

Spec: F2 (pay table capture) and F3.1 (hand photo) in `02-PRODUCT-SPEC.md`; Tech Spec §7.3–7.4 (`paytable_extract`,
`hand_extract`, image pipeline); Prompt 9 in `05-REPLIT-AGENT-PROMPTS.md`. Also folds in the follow-up from PR #4: the
strategy-chart line in AI explanations.
Status: **built** (see replit.md "Photo capture").

Goal: point your phone at a machine and get its pay table into the app in seconds, or photograph a hand and see the
best hold. **The AI only reads the picture; everything after that is the app's own code and the engine**: mapping row
names to hands, checking the numbers, and computing return and strategy. Nothing is saved until you confirm it.

## P1 — Taking or choosing a photo
- One shared **"From a photo"** control: on phones it opens the camera (`capture="environment"`); on computers it opens
  a file picker. Pasting an image from the clipboard also works.
- **On the device, before sending:** resize to at most 1,600 px on the long edge, re-encode as JPEG (quality ≈ 0.8),
  which also drops location and other EXIF data. Show a thumbnail with the estimated cost (see P5) and a **Read photo**
  button — nothing is sent until you press it.
- **Not kept by default:** the photo is discarded after you confirm. An option ("Keep photos on this device") keeps it
  with the result. Reading the same photo again is free: results are cached by the photo's fingerprint (SHA-256).

## P2 — Pay table from a photo (`paytable_extract`)
- **What the model returns** (schema-checked): each row's label as printed, its pays for 1–5 coins, a confidence per
  row; its guess at the game; denomination and number of lines if shown; and whether it looks like a multiplier game
  (Ultimate X, Super Times Pay, Multi-Strike…).
- **Mapping is ours, not the model's:** a synonym dictionary turns printed labels ("4 ACES W/2-4", "FOUR ACES WITH ANY
  2,3,4", "STR FLUSH", "3 OF A KIND") into the app's hand ranks for each game. The game is chosen from which rows are
  present (e.g. "Four Aces with 2–4" → Double Double Bonus); the model's guess is only a tie-breaker. Unknown labels are
  shown for you to assign, never guessed.
- **Checks (F2.2)**, reusing the pay table editor's checks plus photo-specific ones: missing rows, a column that isn't
  5× the 1-coin column (except the royal), pays that go down as hands get stronger, and an implausible royal.
- **Confirm grid (F2.3):** the existing pay table editor opens filled in from the photo, with low-confidence and
  flagged cells highlighted, the photo beside it to compare, and **"Looks like 9/6 Double Double Bonus"** when it
  matches a built-in table exactly (or "differs from 9/6 Jacks only in Full House and Flush" when it is close).
- **After confirming (F2.4):** the table is saved like any custom table (a built-in match uses the built-in one), and
  the app shows its exact return, its common name, where its return ranks among the tables for that game, and how its
  strategy differs from the closest built-in table (see question 2). The full analysis runs in the worker with a
  progress bar (about 20 s, once).
- **Multiplier games:** "Ultimate X and similar games aren't supported yet" — with an offer to save the base pay table.
- **Entry points:** "From a photo" in Settings → Your pay tables, in the machine editor's "Enter a pay table…", and a
  "Photograph a pay table" card in the New machine sheet's popular machines.

## P3 — Hand from a photo (`hand_extract`)
- **What the model returns:** the five cards left to right (rank, suit, confidence each) and which are held (when the
  machine shows HELD), schema-checked; five distinct cards required.
- **Confirm:** the five cards appear in the Analyzer's hand slots with any low-confidence card outlined; tap a card to
  correct it with the picker. Held cards become "What I held".
- **Entry point:** a **From a photo** button in the Analyzer beside Random hand and Clear.

## P4 — Strategy-chart line in explanations (follow-up from #4)
- When the bet is max and the table's charts are available, the Expert chart's line for the best hold ("Expert chart ·
  line 9 of 47: Two pair") is added to the facts the AI explains from, so explanations can cite it. Its numbers join the
  numbers the check allows.

## P5 — Models and cost
- Photos use the **vision** setting (provider and model size, already in the data model; default Heavy — see question
  3) and the same Light / Medium / Heavy selector, shown beside **Read photo** with an estimated cost per size.
- Image size is converted to tokens with each provider's published rule of thumb; the estimate is shown as "about", and
  the real cost from the usage appears after, as with Explain. Rough guide for a 1,600 × 1,200 photo: Heavy (Opus 5.5)
  about 4¢, Medium (Sonnet 5.5) about 2¢, Light (Haiku 5.5) about 0.2¢.
- The usage log gains the two new tasks, so Settings → AI shows what photos cost.

## P6 — Testing
- **Unit:** synonym dictionary and game detection (every built-in table's labels, common variants, unknown labels);
  photo checks; mapping a model reply to a draft table; image fingerprint cache; hand reply validation; the chart line in
  the explanation facts.
- **Browser:** no real photos or API calls are needed — the tests render the app's own pay table and cards to an image,
  upload it, and answer from intercepted Anthropic / OpenAI APIs. Covered: camera/file input, resize, cost estimate,
  confirm grid with highlights, unknown-label assignment, library match, save and analysis, multiplier warning, hand
  photo into the Analyzer with held cards, cache hit (no second call), keep-photo option.
- **Accuracy (F2.1's "≥ 90% of 50 real photos"):** `scripts/vision-eval.ts`, a developer script that reads keys from
  the environment and scores a folder of your photos against their correct tables. It needs real photos, so it is run
  by you (or on your machine); I can't measure accuracy here.

## Out of scope
- Multiplier games themselves (Ultimate X etc.) — later, via the hooks in `06-MULTIPLIER-GAMES.md`.
- Reading credits or the bet from a hand photo.

## Decisions (confirmed)
1. **Photos are discarded** after confirming; there is no option to keep them. (The read result is cached by the
   photo's fingerprint, without the photo, so reading the same photo again is free.)
2. **Strategy difference** is shown as "the best hold changes on X% of deals compared with <closest built-in table>",
   with the first few hands where it changes.
3. **Default model for photos: Medium** (Claude Sonnet 5.5 / GPT-6.2 Sol), changeable per photo and in Settings → AI.
4. **Hand photos offer both:** when the hand photo also shows a pay table, offer to read it too (a second, separate
   read with its own cost estimate, confirmed like any pay table photo).

## Questions
1. **Photos:** discard after confirming by default, with an opt-in "Keep photos on this device" — OK?
2. **"How its strategy differs":** the spec says "differs from the base game in N lines". I'd rather show **"the best
   hold changes on X% of deals compared with 9/6 Jacks or Better"** (exact, from both full analyses), plus the first few
   hands where it changes. Use that, or count chart lines as the spec says?
3. **Default model for photos:** Heavy (most accurate, about 4¢ a photo), or Medium (about 2¢)?
4. **Hand photos:** also offer to capture the pay table when one is visible in the same photo (a second, separate read
   you'd confirm), or keep hand photos to the cards only?
