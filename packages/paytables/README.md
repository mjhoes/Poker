# Launch pay-table library

`src/library.json` defines the eight Prompt 3 tables as max-coin per-coin values,
in the corresponding game family's rank order. The exported library expands
these into total-coin payout columns 1–5. Royals pay 250 per coin at bets 1–4
and 800 per coin at five; all other rows are linear.

Names/slugs are display identifiers; `id` is the SHA-256 of canonical family
and payout-row JSON. Display-name changes and row insertion order do not change
that ID. `analysisKey` also includes the engine version, selected value vector,
and bet normalization.

`referenceReturnPct` and the two source links are QA metadata only.
`analyzeGame` computes all production return figures independently.

## Reference checks

Pay tables and rounded returns were checked against both:

- [Wizard of Odds summary tables](https://wizardofodds.com/games/video-poker/summary/)
- [vpFREE2 pay-table listings](https://www.vpfree2.com/video-poker/pay-tables)

Family-specific source links are retained alongside every entry. Tests permit
the PRD's ±0.005 percentage-point tolerance because the listings round their
headline percentages. The fuller reference figures are used for regression
comparison, not as asserted exact rational results. No strategy charts are
copied; all optimal holds are derived by our own engine.
