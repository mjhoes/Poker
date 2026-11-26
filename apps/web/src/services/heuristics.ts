import { heuristicSchema, newId, uuid } from "@perfect-draw/shared";
import type { HeuristicScore, RuleAST } from "@perfect-draw/engine";
import type { z } from "zod";
import { db, live, requireRecord } from "../data/db";
import { draftToAst, ruleWords } from "../heuristics/rules";
import type { RuleDraft } from "../heuristics/rules";
import { engineClient } from "../worker/client";
import { trainingService } from "./training";

/*
 * Personal heuristic cards and the Rule Lab (docs/17-HEURISTICS-PLAN.md). The engine writes and scores every rule; AI
 * only rewords a card (heuristics-ai.ts).
 */

export type HeuristicCard = z.infer<typeof heuristicSchema>;
const base = (label: string) => label.split("|")[0];
/** The pay table and bet of a machine, which a card is scored at. */
async function terms(machineId: string) {
  uuid.parse(machineId);
  const machine = await requireRecord("machines", machineId);
  return { paytableId: machine.paytableId, coins: machine.coins };
}
function record(input: { paytableId: string; coins: number; source: "engine" | "lab"; pair: [string, string]; rule: RuleAST; score: HeuristicScore; familyId: string; existing?: HeuristicCard }) {
  const now = Date.now();
  const words = ruleWords(input.rule, input.familyId);
  const examples = (rows: HeuristicScore["examples"]) => rows.map(row => ({ hand: [...row.hand], mask: row.mask, bestMask: row.bestMask, evLoss: row.evLoss, weight: row.weight, exception: row.exception }));
  return heuristicSchema.parse({
    id: input.existing?.id ?? newId(), createdAt: input.existing?.createdAt ?? now, updatedAt: now, deletedAt: null,
    paytableId: input.paytableId, coins: input.coins, source: input.source, targetLabelPair: input.pair, ruleAst: input.rule,
    // New engine words replace polished ones only when the rule itself changed.
    ...(input.existing && JSON.stringify(input.existing.ruleAst) === JSON.stringify(input.rule)
      ? { ruleText: input.existing.ruleText, mnemonic: input.existing.mnemonic, exceptions: input.existing.exceptions, aiModel: input.existing.aiModel, mnemonicStyle: input.existing.mnemonicStyle }
      : { ruleText: words.rule, mnemonic: "", exceptions: words.exceptions, aiModel: null, mnemonicStyle: null }),
    examples: examples(input.score.examples), counterexamples: examples(input.score.counterexamples),
    costPct: input.score.costPct, costWithoutExceptionsPct: input.score.costWithoutExceptionsPct,
    appliesFreq: Math.min(1, input.score.appliesFreq), rightFreq: Math.min(1, input.score.rightFreq),
    status: input.existing?.status ?? "active",
  });
}
const sameCard = (card: HeuristicCard, paytableId: string, coins: number, pair: readonly [string, string]) =>
  live(card) && card.paytableId === paytableId && card.coins === coins && card.targetLabelPair[0] === pair[0] && card.targetLabelPair[1] === pair[1];

export const heuristicService = {
  categories: (paytableId: string, coins: number) => engineClient().heuristicCategories(paytableId, coins),
  score: (paytableId: string, coins: number, rule: RuleAST) => engineClient().scoreHeuristic(paytableId, coins, rule),
  async cards() { return (await db.records("heuristicCards").toArray()).filter(live).map(row => heuristicSchema.parse(row)); },
  /**
   * Cards for a machine's costliest mistakes (the Weakness Trainer's targets): "hold <best> over <what you held>", with
   * the exceptions the engine finds. Pairs of the same category (which cards to keep) can't be a rule and are skipped.
   * Making cards again updates each pair's card.
   */
  async fromMistakes(machineId: string) {
    const { paytableId, coins } = await terms(machineId);
    const familyId = await trainingService.familyOf(paytableId);
    const targets = await trainingService.weaknessTargets(paytableId, coins);
    const made: HeuristicCard[] = [];
    let skipped = 0;
    for (const target of targets) {
      const [prefer, over] = base(target.bestLabel) !== base(target.chosenLabel)
        ? [base(target.bestLabel), base(target.chosenLabel)] : [target.bestLabel, target.chosenLabel];
      if (prefer === over) { skipped++; continue; }
      const pair: [string, string] = [prefer, over];
      if (made.some(card => card.targetLabelPair[0] === prefer && card.targetLabelPair[1] === over)) continue;
      const bare = draftToAst({ prefer, over, unless: [] });
      const suggestion = await engineClient().suggestHeuristic(paytableId, coins, bare.prefer, bare.over);
      const existing = (await heuristicService.cards()).find(card => sameCard(card, paytableId, coins, pair));
      const card = record({ paytableId, coins, source: "engine", pair, rule: suggestion.rule, score: suggestion.score, familyId, existing });
      await db.records("heuristicCards").put(card);
      made.push(card);
    }
    return { made, skipped, targets: targets.length };
  },
  /** Saves a Rule Lab rule as a card, scored again by the engine. */
  async saveFromLab(machineId: string, draft: RuleDraft) {
    const { paytableId, coins } = await terms(machineId);
    const familyId = await trainingService.familyOf(paytableId);
    const rule = draftToAst(draft);
    const score = await heuristicService.score(paytableId, coins, rule);
    const pair: [string, string] = [draft.prefer, draft.over];
    const existing = (await heuristicService.cards()).find(card => sameCard(card, paytableId, coins, pair) && card.source === "lab");
    const card = record({ paytableId, coins, source: "lab", pair, rule, score, familyId, existing });
    await db.records("heuristicCards").put(card);
    return card;
  },
  async setStatus(id: string, status: "active" | "archived") {
    return db.transaction("rw", db.records("heuristicCards"), async () => {
      const card = heuristicSchema.parse(await requireRecord("heuristicCards", id));
      await db.records("heuristicCards").put(heuristicSchema.parse({ ...card, status, updatedAt: Date.now() }));
    });
  },
  /** Saves AI-polished words (already checked) on a card whose rule hasn't changed since it was asked. */
  async applyWords(id: string, rule: unknown, words: { ruleText: string; mnemonic: string; exceptions: string[]; aiModel: string; mnemonicStyle: string }) {
    return db.transaction("rw", db.records("heuristicCards"), async () => {
      const card = heuristicSchema.parse(await requireRecord("heuristicCards", id));
      if (JSON.stringify(card.ruleAst) !== JSON.stringify(rule)) throw new Error("This card changed while the AI was writing. Try again.");
      const next = heuristicSchema.parse({ ...card, ...words, updatedAt: Date.now() });
      await db.records("heuristicCards").put(next);
      return next;
    });
  },
};
