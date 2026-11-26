import * as z from "zod/v4";
import type { AiProvider, AiTier } from "@perfect-draw/shared";
import type { RuleAST } from "@perfect-draw/engine";
import { checkNumbers, factNumbers } from "./explain-facts";
import { estimateCallCost, modelFor } from "./models";
import { runTask } from "./router";
import { AiError } from "./types";
import { astToDraft, draftToAst, MAX_CONDITIONS, RANKS, ruleWords } from "../heuristics/rules";
import type { ConditionDraft, RuleDraft } from "../heuristics/rules";
import { heuristicService } from "../services/heuristics";
import type { HeuristicCard } from "../services/heuristics";
import { trainingService } from "../services/training";
import { maskIndexes, shortCard } from "../table/cards";
import { gradeLabel } from "../table/Feedback";

/*
 * AI for heuristics (docs/17-HEURISTICS-PLAN.md): polishing a card's words with a mnemonic, and turning a rule typed in
 * plain English into the Rule Lab's fields. The engine owns the rule and every number; replies are checked against it.
 */

export type MnemonicStyle = "phrase" | "acronym" | "rhyme" | "story";
export const MNEMONIC_STYLES: readonly { id: MnemonicStyle; label: string; hint: string }[] = [
  { id: "phrase", label: "Short phrase", hint: "A punchy line of a few words" },
  { id: "acronym", label: "Acronym", hint: "Letters to remember, and what they stand for" },
  { id: "rhyme", label: "Rhyme", hint: "A short rhyming couplet" },
  { id: "story", label: "Story", hint: "Two sentences that picture the rule" },
];
const STYLE_GUIDE: Record<MnemonicStyle, string> = {
  phrase: "a punchy phrase of at most 10 words",
  acronym: "an acronym: the letters, then what each stands for, in one line",
  rhyme: "a rhyming couplet (two short lines)",
  story: "a tiny story of at most two sentences that pictures the rule",
};

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const held = (hand: readonly number[], mask: number) => maskIndexes(mask).map(index => shortCard(hand[index])).join(" ") || "nothing (draw five)";

/** What the AI is told about a card: the engine's rule in words, its exact costs, and example deals. */
export function polishFacts(card: HeuristicCard, context: { familyId: string; game: string; payTable: string; style: MnemonicStyle }) {
  const words = ruleWords(card.ruleAst as unknown as RuleAST, context.familyId);
  return {
    game: context.game, payTable: context.payTable, coinsBet: card.coins,
    rule: words.rule, exceptions: words.exceptions,
    holds: { preferred: gradeLabel(card.targetLabelPair[0], context.familyId), other: gradeLabel(card.targetLabelPair[1], context.familyId) },
    costIfFollowedPctOfReturn: round(card.costPct, 3), costWithoutExceptionsPctOfReturn: round(card.costWithoutExceptionsPct, 3),
    rightPctOfTheDealsItDecides: round(card.rightFreq * 100, 1), dealsItDecidesPer1000: round(card.appliesFreq * 1000, 1),
    examples: card.examples.slice(0, 4).map(example => ({ cards: example.hand.map(shortCard).join(" "), hold: held(example.hand, example.mask), from: example.exception ? "an exception" : "the rule" })),
    mnemonicStyle: STYLE_GUIDE[context.style],
  };
}
export type PolishFacts = ReturnType<typeof polishFacts>;

export const POLISH_SYSTEM = [
  "You write personal video poker heuristic cards: a rule a player can remember at the machine.",
  "The DATA's rule and exceptions are exact and were checked by a solver over every deal. Keep their meaning exactly: the same two holds, the same preference, every exception in the same order.",
  "Reply with JSON: {\"ruleText\": one plain sentence stating the rule, \"exceptions\": one plain sentence per DATA exception (an empty list when there are none), \"mnemonic\": in the style the DATA asks for}.",
  "Every number you write must appear in the DATA. Don't calculate, round differently or compare numbers, and don't add advice beyond the rule.",
].join("\n");
export const polishPrompt = (facts: PolishFacts) => `DATA:\n${JSON.stringify(facts, null, 2)}`;
const polishSchema = z.object({ ruleText: z.string(), exceptions: z.array(z.string()), mnemonic: z.string() });
type Polish = z.infer<typeof polishSchema>;

/*
 * Ranks a reply names. A wrong rank is the easiest way for a reworded rule to change its meaning without a number:
 * "When the pair includes an Ace" for an exception about 2s. Plural rank words and the face cards count; "four to a
 * flush" and "two pair" don't.
 */
const RANK_PATTERNS: readonly [RegExp, string][] = [
  [/\baces?\b/gi, "A"], [/\bkings?\b/gi, "K"], [/\bqueens?\b/gi, "Q"], [/\bjacks?\b/gi, "J"], [/\btens\b/gi, "T"],
  [/\bnines\b/gi, "9"], [/\beights\b/gi, "8"], [/\bsevens\b/gi, "7"], [/\bsixes\b/gi, "6"], [/\bfives\b/gi, "5"],
  [/\bfours\b/gi, "4"], [/\bthrees\b/gi, "3"], [/\b(?:twos|deuces?)\b/gi, "2"],
];
export function rankMentions(text: string) {
  return new Set(RANK_PATTERNS.filter(([pattern]) => new RegExp(pattern.source, "i").test(text)).map(([, rank]) => rank));
}
const RANK_NAMES: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten" };

/**
 * What a reply gets wrong, or null: lengths, one sentence per exception, numbers only from the facts, and ranks only
 * from the facts (the rule's own ranks and those in the holds' and game's names). Whether the words still mean the
 * engine's rule is checked after this, by reading them back into a rule (heuristicsAi.polish).
 */
export function polishProblem(reply: Polish, facts: PolishFacts, ruleRanks: readonly string[] = []): string | null {
  if (!reply.ruleText.trim() || reply.ruleText.length > 600) return "ruleText must be one sentence (under 600 characters).";
  if (!reply.mnemonic.trim() || reply.mnemonic.length > 300) return "mnemonic must be non-empty and under 300 characters.";
  if (reply.exceptions.length !== facts.exceptions.length) return `Give exactly ${facts.exceptions.length} exception sentence(s), one per DATA exception, in order.`;
  if (reply.exceptions.some(text => !text.trim() || text.length > 400)) return "Each exception must be one sentence under 400 characters.";
  const text = [reply.ruleText, reply.mnemonic, ...reply.exceptions].join(" ");
  const bad = checkNumbers(text, factNumbers(facts));
  if (bad.length) return `Numbers not in the DATA: ${bad.join(", ")}. Use only numbers from the DATA.`;
  // Hold names can carry ranks as letters, like "Unsuited KQJ".
  const lettered = [facts.holds.preferred, facts.holds.other].join(" ").match(/\b[2-9TJQKA]{2,3}\b/g)?.join("").split("") ?? [];
  const allowed = new Set([...rankMentions(JSON.stringify(facts)), ...ruleRanks, ...lettered]);
  const foreign = [...rankMentions(text)].filter(rank => !allowed.has(rank));
  return foreign.length ? `Ranks not in the DATA's rule: ${foreign.map(rank => RANK_NAMES[rank] ?? rank).join(", ")}. Keep the DATA's ranks exactly.` : null;
}

const sortedConditions = (draft: RuleDraft) => draft.unless.map(item => JSON.stringify([item.type, item.on, item.type.startsWith("rank") ? item.rank : null])).sort();
/** The same rule: the same two holds the same way round, and the same exceptions (in any order). */
export const sameRule = (a: RuleDraft, b: RuleDraft) =>
  a.prefer === b.prefer && a.over === b.over && JSON.stringify(sortedConditions(a)) === JSON.stringify(sortedConditions(b));

/** Reads a sentence back into the Rule Lab's fields (null when the AI says it isn't a rule between two holds). */
async function readRule(sentence: string, categories: readonly { code: string; name: string }[], options: { provider: AiProvider; tier: AiTier }) {
  const codes = new Set(categories.map(item => item.code));
  const result = await runTask({
    task: "heuristic_parse", provider: options.provider, tier: options.tier, system: PARSE_SYSTEM, prompt: parsePrompt(sentence, categories),
    schema: parseSchema, check: reply => parseProblem(reply, codes),
  });
  const draft: RuleDraft | null = result.data.understood
    ? { prefer: result.data.prefer!, over: result.data.over!, unless: result.data.unless.map(item => ({ type: item.type, on: item.on, rank: item.type.startsWith("rank") ? item.rank : null })) }
    : null;
  return { draft, note: result.data.note, cost: result.cost, calls: result.calls, model: result.model };
}

const TYPICAL_POLISH_TOKENS = 700, TYPICAL_PARSE_TOKENS = 500;
/** Room for a table's category list in a read-back prompt, for the estimate. */
const CATEGORY_LIST_ALLOWANCE = "x".repeat(1200);

export const heuristicsAi = {
  /** A polish is two calls: the rewording, then reading it back into a rule. */
  estimatePolish(facts: PolishFacts, provider: AiProvider, tier: AiTier) {
    const model = modelFor(provider, tier).id;
    return estimateCallCost(model, POLISH_SYSTEM + polishPrompt(facts), TYPICAL_POLISH_TOKENS)
      + estimateCallCost(model, PARSE_SYSTEM + [facts.rule, ...facts.exceptions].join(" ") + CATEGORY_LIST_ALLOWANCE, TYPICAL_PARSE_TOKENS);
  },
  /**
   * Rewords a card and adds a mnemonic. The words must still mean the engine's rule: a second call reads them back
   * into a rule, which must be the card's own (the same holds the same way round, the same conditions on the same
   * holds). A reply that fails the checks or reads as another rule gets one more try; then nothing is saved.
   */
  async polish(card: HeuristicCard, facts: PolishFacts, options: { provider: AiProvider; tier: AiTier; style: MnemonicStyle }) {
    const expected = astToDraft(card.ruleAst as unknown as RuleAST);
    if (!expected) throw new AiError("invalid_output", "This rule can't be checked word for word, so it can't be polished.");
    const familyId = await trainingService.familyOf(card.paytableId);
    const codes = await heuristicService.categories(card.paytableId, card.coins);
    const categories = [...new Set([...codes, ...card.targetLabelPair])].map(code => ({ code, name: gradeLabel(code, familyId) }));
    const ruleRanks = expected.unless.flatMap(item => item.rank && item.type.startsWith("rank") ? [item.rank] : []);
    const totals = { cost: 0, calls: 0 };
    let note = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await runTask({
        task: "heuristic_polish", provider: options.provider, tier: options.tier, system: POLISH_SYSTEM, prompt: polishPrompt(facts) + note,
        schema: polishSchema, check: reply => polishProblem(reply, facts, ruleRanks),
      });
      totals.cost += result.cost; totals.calls += result.calls;
      const back = await readRule([result.data.ruleText, ...result.data.exceptions].join(" "), categories, options);
      totals.cost += back.cost; totals.calls += back.calls;
      if (back.draft && sameRule(back.draft, expected)) {
        const saved = await heuristicService.applyWords(card.id, card.ruleAst, {
          ruleText: result.data.ruleText.trim(), mnemonic: result.data.mnemonic.trim(), exceptions: result.data.exceptions.map(text => text.trim()),
          aiModel: result.model, mnemonicStyle: options.style,
        });
        return { card: saved, cost: totals.cost, calls: totals.calls, model: result.model };
      }
      const meant = back.draft ? Object.values(ruleWords(draftToAst(back.draft), familyId)).flat().join(" ") : "not a rule between two holds.";
      note = `\n\nYour last wording reads as a different rule: "${meant}" Keep the DATA's rule exactly: the same two holds the same way round, and each exception's condition on the same hold.`;
    }
    throw new AiError("invalid_output", "The AI's wording read as a different rule, so it wasn't saved. The card keeps its words.");
  },
  estimateParse(prompt: string, provider: AiProvider, tier: AiTier) {
    return estimateCallCost(modelFor(provider, tier).id, PARSE_SYSTEM + prompt, TYPICAL_PARSE_TOKENS);
  },
  /** Turns a rule typed in plain English into the Rule Lab's fields, using only the table's categories. */
  async parse(sentence: string, categories: readonly { code: string; name: string }[], options: { provider: AiProvider; tier: AiTier }): Promise<{ draft: RuleDraft; cost: number; model: string }> {
    const text = sentence.trim();
    if (!text) throw new Error("Type a rule first.");
    if (text.length > 500) throw new Error("Keep the rule under 500 characters.");
    const result = await readRule(text, categories, options);
    if (!result.draft) throw new AiError("invalid_output", result.note?.trim() || "The AI couldn't turn that into a rule. Try naming two holds, like \"4 to a flush over a low pair\".");
    return { draft: result.draft, cost: result.cost, model: result.model };
  },
};

export const PARSE_SYSTEM = [
  "You turn a video poker rule written in plain English into fields for a rule builder.",
  "A rule says: hold the PREFER category over the OVER category, unless any exception applies (then hold OVER).",
  "Use only category codes from the CATEGORIES list (pick the closest match). Exception types: flush_penalty, straight_penalty (on a hold), rank_held, rank_discarded (with a rank from A K Q J T 9 8 7 6 5 4 3 2). `on` is \"preferred\" or \"other\".",
  `At most ${MAX_CONDITIONS} exceptions. If the text isn't a rule between two holds, set understood to false and say why in note.`,
  "Reply with JSON: {\"understood\": boolean, \"prefer\": code or null, \"over\": code or null, \"unless\": [{\"type\", \"on\", \"rank\": rank or null}], \"note\": string or null}.",
].join("\n");
export const parsePrompt = (sentence: string, categories: readonly { code: string; name: string }[]) =>
  `CATEGORIES:\n${categories.map(item => `${item.code}: ${item.name}`).join("\n")}\n\nRULE:\n${sentence}`;
const conditionSchema = z.object({
  type: z.enum(["flush_penalty", "straight_penalty", "rank_held", "rank_discarded"]), on: z.enum(["preferred", "other"]), rank: z.string().nullable(),
});
const parseSchema = z.object({
  understood: z.boolean(), prefer: z.string().nullable(), over: z.string().nullable(), unless: z.array(conditionSchema), note: z.string().nullable(),
});
export function parseProblem(reply: z.infer<typeof parseSchema>, codes: ReadonlySet<string>): string | null {
  if (!reply.understood) return null;
  if (!reply.prefer || !codes.has(reply.prefer)) return `prefer must be one of the CATEGORIES codes (got ${JSON.stringify(reply.prefer)}).`;
  if (!reply.over || !codes.has(reply.over)) return `over must be one of the CATEGORIES codes (got ${JSON.stringify(reply.over)}).`;
  if (reply.prefer === reply.over) return "prefer and over must be different categories.";
  if (reply.unless.length > MAX_CONDITIONS) return `At most ${MAX_CONDITIONS} exceptions.`;
  const badRank = (item: ConditionDraft) => (item.type === "rank_held" || item.type === "rank_discarded") && !RANKS.includes(item.rank as typeof RANKS[number]);
  if (reply.unless.some(badRank)) return "Rank exceptions need a rank: one of A K Q J T 9 8 7 6 5 4 3 2.";
  return null;
}
