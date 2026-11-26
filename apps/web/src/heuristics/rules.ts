import type { HoldSelector, RuleAST, RuleCondition } from "@perfect-draw/engine";
import { gradeLabel } from "../table/Feedback";

/*
 * Heuristic rules in the form people and the Rule Lab use (docs/17-HEURISTICS-PLAN.md): "hold A over B, unless any of
 * these — then hold B". Converts to and from the engine's RuleAST and writes the rule in words.
 */

export type ConditionType = "flush_penalty" | "straight_penalty" | "rank_held" | "rank_discarded";
/** One exception. `on`: which hold it looks at (the preferred one, A, or the other, B). `rank` for rank conditions. */
export type ConditionDraft = { type: ConditionType; on: "preferred" | "other"; rank: string | null };
export type RuleDraft = { prefer: string; over: string; unless: ConditionDraft[] };
export const MAX_CONDITIONS = 3;
export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

/** A category with modifiers ("4FL|pen:straight") is matched exactly; a plain one matches every variant of it. */
const selector = (label: string): HoldSelector => label.includes("|") ? { label, match: "exact" } : { label };
function toCondition(draft: ConditionDraft): RuleCondition {
  const on = draft.on === "other" ? "over" : "preferred";
  if (draft.type === "flush_penalty" || draft.type === "straight_penalty") return { kind: "penalty", penalty: draft.type === "flush_penalty" ? "flush" : "straight", on };
  if (!draft.rank || !RANKS.includes(draft.rank as typeof RANKS[number])) throw new Error("Choose a rank for this exception.");
  return { kind: "rank", rank: draft.rank, in: draft.type === "rank_held" ? "held" : "discarded", on };
}
export function draftToAst(draft: RuleDraft): RuleAST {
  if (!draft.prefer || !draft.over) throw new Error("Choose both holds.");
  if (draft.prefer === draft.over) throw new Error("Choose two different holds.");
  if (draft.unless.length > MAX_CONDITIONS) throw new Error(`At most ${MAX_CONDITIONS} exceptions.`);
  const conditions = draft.unless.map(toCondition);
  return {
    kind: "prefer", prefer: selector(draft.prefer), over: selector(draft.over),
    ...(conditions.length ? { unless: conditions.length === 1 ? conditions[0] : { kind: "or", conditions } } : {}),
  };
}
function fromCondition(condition: RuleCondition): ConditionDraft | null {
  const on = condition.kind === "penalty" || condition.kind === "rank" ? (condition.on === "over" ? "other" : "preferred") : "preferred";
  if (condition.kind === "penalty" && (condition.min ?? 1) === 1) return { type: condition.penalty === "flush" ? "flush_penalty" : "straight_penalty", on, rank: null };
  if (condition.kind === "rank") return { type: condition.in === "held" ? "rank_held" : "rank_discarded", on, rank: condition.rank };
  return null;
}
/** The draft for a rule the builder can show (plain selectors and "any of" simple exceptions), else null. */
export function astToDraft(ast: RuleAST): RuleDraft | null {
  const plain = (item: HoldSelector) => item.heldRanks === undefined && (item.match ?? "base") !== "prefix";
  if (!plain(ast.prefer) || !plain(ast.over)) return null;
  const parts = !ast.unless ? [] : ast.unless.kind === "or" ? ast.unless.conditions : [ast.unless];
  const unless = parts.map(fromCondition);
  if (unless.some(item => item === null) || unless.length > MAX_CONDITIONS) return null;
  return { prefer: ast.prefer.label, over: ast.over.label, unless: unless as ConditionDraft[] };
}

const RANK_WORDS: Record<string, string> = { A: "an Ace", K: "a King", Q: "a Queen", J: "a Jack", T: "a Ten", "8": "an 8" };
export const rankWord = (rank: string) => RANK_WORDS[rank] ?? `a ${rank}`;
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
export const holdName = (label: string, familyId: string) => lower(gradeLabel(label, familyId));

/** One exception in words, about the two holds' names. */
export function conditionText(condition: ConditionDraft, prefer: string, over: string) {
  const hold = condition.on === "other" ? over : prefer;
  switch (condition.type) {
    case "flush_penalty": return `keeping ${hold} means throwing away a card of its suit (a flush penalty)`;
    case "straight_penalty": return `keeping ${hold} means throwing away a card that could help a straight (a straight penalty)`;
    case "rank_held": return `${hold} includes ${rankWord(condition.rank ?? "?")}`;
    case "rank_discarded": return `keeping ${hold} means throwing away ${rankWord(condition.rank ?? "?")}`;
  }
}
/** The rule and each exception in words, as the engine writes a card. */
export function ruleWords(ast: RuleAST, familyId: string): { rule: string; exceptions: string[] } {
  const draft = astToDraft(ast);
  const prefer = holdName(ast.prefer.label, familyId), over = holdName(ast.over.label, familyId);
  const rule = `Hold ${prefer} over ${over}.`;
  if (!draft) return { rule, exceptions: ast.unless ? ["Except in the cases this rule's conditions describe."] : [] };
  return { rule, exceptions: draft.unless.map(condition => `When ${conditionText(condition, prefer, over)}, hold ${over} instead.`) };
}
