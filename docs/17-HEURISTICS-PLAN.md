# Heuristics: personal cards and the Rule Lab

Spec: F6.1–F6.2 in `02-PRODUCT-SPEC.md`; Tech Spec §3.7 (heuristic validator), `heuristicCards`, `heuristic_generate`.
Status: **built**. The printable PDF (F6.3) is a later round.

## Decisions (from the owner)

1. **Cards: engine first, AI polish.** The engine writes each card's rule, exception and example hands from your top
   mistakes, so cards work without an API key. With a key, "Polish with AI" asks for catchier wording and a mnemonic;
   the engine checks the reply (same numbers, the exception kept) before it's saved.
2. **Rule Lab: builder plus plain English.** Pick "Prefer [hold] over [hold] unless [condition]" from lists and see the
   exact cost at once. With a key, type the rule in plain English and the AI fills in the same builder.
3. **Mnemonic style: you pick** (short phrase, acronym, rhyme or story; default short phrase).
4. **PDF later.**

## H1: What a rule means and costs

A heuristic is local: *"Hold A over B, unless X — then hold B."* It decides only deals where both an A hold and a B hold
exist and one of them is the best play (any other best play is left alone, as the spec's validator does). On those
deals the card picks A, or B when an exception matches.

- **Cost if followed** = the EV it gives up on those deals, as a share of the table's return (%), exceptions included.
- **Cost without the exception** = the same with A always: what following the bare rule blindly costs.
- **Applies to** = how often such a deal comes up (share of real deals); **right** = how often the card's pick is best.
- **Examples**: the most common deals where the card is right (rule and exception), and the costliest where it's wrong.

Engine: `scoreHeuristic(rule, analysisKey)` (new; `evaluateRule` keeps its skip semantics for existing callers).

## H2: Cards from your mistakes

- **Make cards from my mistakes** on a machine's table: the Weakness Trainer's targets (Statistics' costliest confusion
  pairs, quiet sessions excluded). Each pair becomes "Hold <best> over <what you held>". Pairs of the same category
  (which cards to keep) can't be written as a rule and are skipped.
- **Exception search** (`suggestExceptions`): greedily adds up to two conditions (a flush or straight penalty on either
  hold, a rank held or discarded) that most reduce the cost, while each removes more loss than a small threshold.
- Cards are saved (`heuristicCards`) with the rule, its words, exceptions, examples and costs; making cards again
  updates the engine's card for the pair (a Rule Lab card for the same holds is yours and is never touched). A card
  shows as mastered when every Train card of its best hold's kind in the card's own game has graduated (round A); while
  an open quiet session holds answers for that kind, it shows neither, as Train hides them, until the session closes.
  You can archive any card.

## H3: AI polish (optional)

The AI gets the engine's rule in words, its costs and example hands, and the chosen mnemonic style, and returns
`{ ruleText, mnemonic, exceptions[] }`. Checks: one sentence per exception; every number must come from the facts (as
Explain does); every rank named must be one of the rule's or in the holds' or game's names. Then a second call reads
the words back into a rule (the Rule Lab's plain-English reader) and it must be the card's own: the same holds the same
way round and the same conditions on the same holds. A reply that fails gets one more try, then the card keeps its
words. Under AI words the card still shows the engine's rule, which is what its costs describe.

## H4: Rule Lab

- Builder: prefer/over pickers (the table's hold categories) and up to three "unless" conditions (any of them).
- Instant engine score, examples and counterexample hands; "Save as card".
- Plain English (with a key): the AI returns the builder's fields (validated against the table's categories); the
  builder fills in and the engine scores it.

## How it's built

- Engine (`packages/engine/src/heuristics.ts`): `scoreHeuristic(rule, key)` and `suggestExceptions(rule, key)` over
  `ruleDeals()` (shared with `evaluateRule`, whose skip semantics are unchanged). Examples prefer deals that hold
  different ranks.
- Worker: `heuristicCategories`, `scoreHeuristic`, `suggestHeuristic` (`StatsEngine`, any bet).
- Web: `heuristics/rules.ts` (builder draft ↔ RuleAST, the rule in words), `services/heuristics.ts` (cards),
  `ai/heuristics-ai.ts` (polish and plain English), `pages/HeuristicsPage.tsx` with `heuristics/RuleLab.tsx` and
  `heuristics/HeuristicCardView.tsx`. Mnemonic style: `aiSettings.mnemonicStyle`.

## Out of scope

Printable PDF (F6.3), pattern-family visuals, LLM-proposed rule changes beyond wording.
