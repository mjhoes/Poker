import * as z from "zod/v4";
import type { AiProvider, AiTier } from "@perfect-draw/shared";
import type { RuleAST } from "@perfect-draw/engine";
import { checkNumbers, factNumbers } from "./explain-facts";
import { estimateCallCost, modelFor } from "./models";
import { runTask } from "./router";
import { AiError } from "./types";
import { MAX_CONDITIONS, RANKS, ruleWords } from "../heuristics/rules";
import type { ConditionDraft, RuleDraft } from "../heuristics/rules";
import { heuristicService } from "../services/heuristics";
import type { HeuristicCard } from "../services/heuristics";
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

/** What a reply gets wrong, or null: lengths, the exceptions kept, and numbers only from the facts. */
export function polishProblem(reply: Polish, facts: PolishFacts): string | null {
  if (!reply.ruleText.trim() || reply.ruleText.length > 600) return "ruleText must be one sentence (under 600 characters).";
  if (!reply.mnemonic.trim() || reply.mnemonic.length > 300) return "mnemonic must be non-empty and under 300 characters.";
  if (reply.exceptions.length !== facts.exceptions.length) return `Give exactly ${facts.exceptions.length} exception sentence(s), one per DATA exception, in order.`;
  if (reply.exceptions.some(text => !text.trim() || text.length > 400)) return "Each exception must be one sentence under 400 characters.";
  const bad = checkNumbers([reply.ruleText, reply.mnemonic, ...reply.exceptions].join(" "), factNumbers(facts));
  return bad.length ? `Numbers not in the DATA: ${bad.join(", ")}. Use only numbers from the DATA.` : null;
}

const TYPICAL_POLISH_TOKENS = 700, TYPICAL_PARSE_TOKENS = 500;

export const heuristicsAi = {
  estimatePolish(facts: PolishFacts, provider: AiProvider, tier: AiTier) {
    return estimateCallCost(modelFor(provider, tier).id, POLISH_SYSTEM + polishPrompt(facts), TYPICAL_POLISH_TOKENS);
  },
  /** Rewords a card and adds a mnemonic; a reply that fails the checks twice is never saved. */
  async polish(card: HeuristicCard, facts: PolishFacts, options: { provider: AiProvider; tier: AiTier; style: MnemonicStyle }) {
    const result = await runTask({
      task: "heuristic_polish", provider: options.provider, tier: options.tier, system: POLISH_SYSTEM, prompt: polishPrompt(facts),
      schema: polishSchema, check: reply => polishProblem(reply, facts),
    });
    const saved = await heuristicService.applyWords(card.id, card.ruleAst, {
      ruleText: result.data.ruleText.trim(), mnemonic: result.data.mnemonic.trim(), exceptions: result.data.exceptions.map(text => text.trim()),
      aiModel: result.model, mnemonicStyle: options.style,
    });
    return { card: saved, cost: result.cost, calls: result.calls, model: result.model };
  },
  estimateParse(prompt: string, provider: AiProvider, tier: AiTier) {
    return estimateCallCost(modelFor(provider, tier).id, PARSE_SYSTEM + prompt, TYPICAL_PARSE_TOKENS);
  },
  /** Turns a rule typed in plain English into the Rule Lab's fields, using only the table's categories. */
  async parse(sentence: string, categories: readonly { code: string; name: string }[], options: { provider: AiProvider; tier: AiTier }): Promise<{ draft: RuleDraft; cost: number; model: string }> {
    const text = sentence.trim();
    if (!text) throw new Error("Type a rule first.");
    if (text.length > 500) throw new Error("Keep the rule under 500 characters.");
    const codes = new Set(categories.map(item => item.code));
    const prompt = parsePrompt(text, categories);
    const result = await runTask({
      task: "heuristic_parse", provider: options.provider, tier: options.tier, system: PARSE_SYSTEM, prompt, schema: parseSchema,
      check: reply => parseProblem(reply, codes),
    });
    if (!result.data.understood) throw new AiError("invalid_output", result.data.note?.trim() || "The AI couldn't turn that into a rule. Try naming two holds, like \"4 to a flush over a low pair\".");
    return { draft: { prefer: result.data.prefer!, over: result.data.over!, unless: result.data.unless.map(item => ({ type: item.type, on: item.on, rank: item.rank })) }, cost: result.cost, model: result.model };
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
