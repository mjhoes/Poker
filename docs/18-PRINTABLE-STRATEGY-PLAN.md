# Printable strategy PDF (F6.3)

Status: **built**. Follows the heuristics round (`17-HEURISTICS-PLAN.md`).

## Decisions (confirmed)

1. **A real PDF file**, made in the browser with pdf-lib and its standard fonts (Helvetica). It works offline and
   looks the same on every device. The library loads only when you ask for a PDF (its own chunk, precached for
   offline use).
2. **Both layouts in one file**: the full chart and your heuristic cards on letter or A4 pages, then a wallet card.
3. **Heuristic cards: the machine's active ones**, mastered included, archived left out.

## What's printed

- **Full pages** (letter where it's the usual size, else A4; you can switch):
  - Title: pay table and tier.
  - The chart's bet (max bet, 5 coins) and its return against perfect play.
  - How to read it: top to bottom, draws don't overlap, and the tie-break rule.
  - The chart in two balanced columns, numbered through. Deuces Wild charts come in sections by deuces held, and lines
    under a section don't repeat the count.
  - "Your heuristics": each card's rule, exceptions, mnemonic and the engine's figures. Under AI wording, the engine's
    own rule is printed too, as on the card in the app.
  - Every page's foot: the date, page number, and "Check a casino's house rules before using a strategy card at the
    table."
- **Wallet card**: the same chart on business-card panels (3.5 × 2 in), two across, with a solid cut line and dashed
  fold lines. It uses the largest type that fits:
  - two panels (one card folded in half), down to 6 pt;
  - else four, down to 5.5 pt;
  - else six, down to 5 pt.

  Every library table's Beginner, Intermediate and Expert chart fits, on letter and A4. A chart that didn't would
  print as much as fits and point to the full pages.

## How it's built

- `apps/web/src/print/strategy-pdf.ts`:
  - `layout()` works out every drawing step (text and lines, page by page) from the content and the fonts' metrics.
  - `buildStrategyPdf()` draws the steps with pdf-lib and sets the document's title, author and dates.
  - `printable()` keeps text the standard fonts can print: common symbols are spelled out (≥, suits) and anything else
    becomes "?". Line breaks stay.
  - `wrap()` breaks text by words, and breaks a word longer than a line.
- `apps/web/src/services/print.ts`:
  - `printService.strategy(machineId, tier)` gathers the pay table's name, the chart (the engine's `ladderChart`, now
    with Deuces sections and the tie-break rule) and the machine's non-archived cards.
  - It returns `printContent()` and a file name such as `perfect-draw-9-6-jacks-or-better-expert.pdf`.
- `apps/web/src/heuristics/PrintPanel.tsx`: "Take your strategy with you" on the Heuristics page. It offers chart tier
  chips, a paper choice and **Download PDF**, then says what was saved.
- Tests:
  - `tests/print-pdf.test.ts`, on the real precomputed charts of all eight library tables at every tier, on both paper
    sizes. It checks that every chart line is printed, numbered, on the full pages and on the wallet card; that all text
    stays inside its page and its wallet panel; and that the PDF opens with the right page count, size and title. Set
    `PRINT_SAMPLES=<dir>` to keep sample files.
  - `e2e/heuristics.spec.ts` "print": saves a Rule Lab card, downloads a Beginner A4 PDF and opens it.

## Later

A layout with the pay table's own pay lines, a choice of which cards to print, and type larger than 5 pt for the
longest Deuces Wild charts (for example, a wallet card of the top lines only).
