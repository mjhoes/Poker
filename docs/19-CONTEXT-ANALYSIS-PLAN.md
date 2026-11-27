# Context analysis and the AI coach report (F5.4, F5.5)

Status: **built**. This was the last item of Phase 3.

## Decisions (confirmed)

1. **Adjust for hand difficulty.** Each situation is compared with what you'd be expected to miss given the hands you
   were dealt there, using your own error rate on each hand type. Raw rates would make a situation that happens to get
   harder hands look worse than it is.
2. **On the Statistics page**: a "When your mistakes happen" section, in the report's scope (table, bet, mode, dates,
   denomination).
3. **AI coach report: on demand, saved.** "Write my coach report" shows the cost first. Reports are kept on this
   device (and in backups) so they can be reread. It needs an AI key.

## Context analysis (engine: `packages/engine/src/context.ts`)

- **Which decisions.** First answers only (corrections excluded), in the report's scope, from decisions not yet
  archived. Raw decisions are kept for 90 days; archived days keep no per-hand context.
- **Situations.**
  - **Decision time:** under 2 s, 2–5 s, 5–10 s, 10 s or more.
  - **Hand in the session:** 1–25, 26–100, 101–300, 301 or later.
  - **After changing pay table:** the first 10 hands after your previous decision was on another pay table within 4
    hours, and the hands after that. Pay Table Switcher sessions change table on purpose, so their own hands are left
    out of this one.
  - **Previous hand:** after a mistake, or after a right answer (the previous first answer in the same session).
  - **Previous draw** (Free Play): after a losing draw, after a win, after a big win (four of a kind or better).
- **Expected mistakes.** A decision's expected chance of a mistake is your error rate on its hand type (its canonical
  best-hold category, as the rest of Statistics uses, not the label saved with the decision), shrunk toward your overall rate (5 hands' worth) and leaving that decision itself out. A situation's
  expected mistakes are the sum over its hands.
- **What's shown per situation.** Hands; mistakes; expected mistakes; the difference per 100 hands with a 95% interval
  (normal approximation, variance Σ p(1−p)); and EV lost per 100 hands against what the hands would cost at your usual
  rates. A difference counts only when its interval excludes zero and there are at least 30 hands.
- **One situation at a time.** Situations that tend to happen together (quick decisions that also follow right
  answers) can both show; the page says so.
- **Findings.** The situations that count, clearest first, as sentences ("Under 2 s, you make 6.2 more mistakes per 100
  hands than these hands would explain (±3.1)").

## Coach report (`apps/web/src/ai/coach.ts`)

- **Facts.** These are computed numbers only:
  - the scope;
  - hands, accuracy and EV lost per 1,000;
  - return against optimal;
  - the top weaknesses, with observed counts and their plain share (mistakes ÷ decisions; the ranking's recency-weighted
    estimate is never given as a record), and the costliest confusions;
  - recent trend;
  - context findings, only those that count.
- **Reply.** `{ headline, wins[], focus[], plan[] }` (Tech Spec §7 `coach_report`). Every number must come from the
  facts, as Explain checks; one retry, then nothing is saved. Lengths are bounded, with 1–4 items per list.
- **Saved** in `coachReports`, with the facts it was written from, the model and the cost. The Statistics page lists
  this scope's reports, newest first, to reread or delete. It's included in backups; a backup made before this table
  existed restores with none.
