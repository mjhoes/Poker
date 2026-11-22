import { getCanonicalHands } from "./canonical";
import { describeHoldUnchecked } from "./labels";
import { getTrainingContext } from "./training";
import type { Hand } from "./types";
import type { HoldPattern } from "./labels";

export interface HoldSelector {
  readonly label: string;
  readonly match?: "base" | "exact" | "prefix";
  readonly heldRanks?: string;
}
export type RuleCondition =
  | { readonly kind: "penalty"; readonly penalty: "flush" | "straight"; readonly on?: "preferred" | "over"; readonly min?: number }
  | { readonly kind: "rank"; readonly rank: string; readonly in: "held" | "discarded"; readonly on?: "preferred" | "over" }
  | { readonly kind: "and" | "or"; readonly conditions: readonly RuleCondition[] }
  | { readonly kind: "not"; readonly condition: RuleCondition };
export interface RuleAST {
  readonly kind: "prefer";
  readonly prefer: HoldSelector;
  readonly over: HoldSelector;
  readonly unless?: RuleCondition;
}
export interface RuleCounterexample {
  readonly canonicalHandId: number;
  readonly hand: Hand;
  readonly chosenMask: number;
  readonly bestMask: number;
  readonly evLoss: number;
  readonly weight: number;
}
export interface RuleEvaluation {
  readonly analysisKey: string;
  readonly returnPct: number;
  readonly costVsOptimal: number;
  readonly handsAffected: number;
  readonly canonicalHandsAffected: number;
  readonly realPlayFreq: number;
  readonly mistakeHands: number;
  readonly counterexamples: readonly RuleCounterexample[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unknown rule property.");
}
function selector(value: unknown): asserts value is HoldSelector {
  if (!isObject(value)) throw new Error("Expected a hold selector.");
  keys(value, ["label", "match", "heldRanks"]);
  if (typeof value.label !== "string" || !value.label.length || value.label.length > 160 ||
      value.match !== undefined && !["base", "exact", "prefix"].includes(String(value.match)) ||
      value.heldRanks !== undefined && (typeof value.heldRanks !== "string" || !/^[2-9TJQKA]{1,5}$/.test(value.heldRanks))) {
    throw new Error("Invalid hold selector.");
  }
}
/** Reject functions, unknown fields, cycles, excessive depth, and invalid JSON. */
export function validateRuleAST(value: unknown): asserts value is RuleAST {
  if (!isObject(value)) throw new Error("Expected a JSON rule object.");
  keys(value, ["kind", "prefer", "over", "unless"]);
  if (value.kind !== "prefer") throw new Error("Only 'prefer' rules are supported.");
  selector(value.prefer); selector(value.over);
  let nodes = 0;
  const condition = (item: unknown, depth: number): void => {
    if (++nodes > 64 || depth > 8 || !isObject(item)) throw new Error("Rule condition is invalid or too complex.");
    if (item.kind === "penalty") {
      keys(item, ["kind", "penalty", "on", "min"]);
      if (!["flush", "straight"].includes(String(item.penalty)) ||
          item.min !== undefined && (!Number.isInteger(item.min) || Number(item.min) < 1 || Number(item.min) > 5) ||
          item.on !== undefined && !["preferred", "over"].includes(String(item.on))) throw new Error("Invalid penalty condition.");
    } else if (item.kind === "rank") {
      keys(item, ["kind", "rank", "in", "on"]);
      if (typeof item.rank !== "string" || !/^[2-9TJQKA]$/.test(item.rank) ||
          !["held", "discarded"].includes(String(item.in)) ||
          item.on !== undefined && !["preferred", "over"].includes(String(item.on))) throw new Error("Invalid rank condition.");
    } else if (item.kind === "and" || item.kind === "or") {
      keys(item, ["kind", "conditions"]);
      if (!Array.isArray(item.conditions) || !item.conditions.length || item.conditions.length > 16) throw new Error("Invalid condition list.");
      for (const child of item.conditions) condition(child, depth + 1);
    } else if (item.kind === "not") {
      keys(item, ["kind", "condition"]); condition(item.condition, depth + 1);
    } else throw new Error("Unsupported rule condition.");
  };
  if (value.unless !== undefined) condition(value.unless, 0);
}

function unlessMatches(condition: RuleCondition, preferred: HoldPattern, over: HoldPattern): boolean {
  if (condition.kind === "and") return condition.conditions.every(child => unlessMatches(child, preferred, over));
  if (condition.kind === "or") return condition.conditions.some(child => unlessMatches(child, preferred, over));
  if (condition.kind === "not") return !unlessMatches(condition.condition, preferred, over);
  if (condition.kind === "penalty") {
    const pattern = condition.on === "over" ? over : preferred;
    return (condition.penalty === "flush" ? pattern.flushPenalty : pattern.straightPenalty) >= (condition.min ?? 1);
  }
  if (condition.kind === "rank") {
    const pattern = condition.on === "over" ? over : preferred;
    return (condition.in === "held" ? pattern.heldRanks : pattern.discardedRanks).includes(condition.rank);
  }
  return false;
}

export function matchesHoldSelector(pattern: HoldPattern, wanted: HoldSelector): boolean {
  const match = wanted.match ?? "base";
  return (match === "base" ? pattern.base === wanted.label : match === "exact"
    ? pattern.label === wanted.label : pattern.label.startsWith(wanted.label)) &&
    (wanted.heldRanks === undefined || wanted.heldRanks === pattern.heldRanks);
}

/** All-deal scoring of a local precedence rule; higher unrelated plays remain optimal. */
export function evaluateRule(rule: RuleAST, analysisKey: string): RuleEvaluation {
  validateRuleAST(rule);
  const context = getTrainingContext(analysisKey), data = context.getData(), hands = getCanonicalHands();
  const known = (wanted: HoldSelector) => data.names[1].some(name => {
    const raw = name.split("|r:")[0].split("|p:")[0];
    return wanted.match === "prefix" ? raw.startsWith(wanted.label)
      : wanted.match === "exact" ? raw === wanted.label : raw.split("|")[0] === wanted.label;
  });
  if (!known(rule.prefer) || !known(rule.over)) throw new Error("Rule uses an unknown hold category.");
  const possible = (name: string, wanted: HoldSelector) => wanted.match === "prefix" ? name.startsWith(wanted.label)
    : wanted.match === "exact" ? name === wanted.label : name.split("|")[0] === wanted.label;
  const rawNames = data.names[1].map(name => name.split("|r:")[0].split("|p:")[0]);
  const canPreferLabel = rawNames.map(name => possible(name, rule.prefer));
  const canOverLabel = rawNames.map(name => possible(name, rule.over));
  let totalLoss = 0, handsAffected = 0, canonicalHandsAffected = 0, mistakeHands = 0;
  const counterexamples: RuleCounterexample[] = [];
  for (let h = 0; h < hands.length; h++) {
    let preferredMask = -1, overMask = -1, preferredEv = -Infinity, overEv = -Infinity;
    for (let mask = 0; mask < 32; mask++) {
      const index = h * 32 + mask;
      const code = data.labels[1][index];
      const canPrefer = canPreferLabel[code], canOver = canOverLabel[code];
      if (!canPrefer && !canOver) continue;
      const pattern = describeHoldUnchecked(hands[h].hand, mask, context.analysis.familyId);
      if (canPrefer && matchesHoldSelector(pattern, rule.prefer) &&
          (preferredMask < 0 || data.preferences[index] > data.preferences[h * 32 + preferredMask])) {
        preferredMask = mask; preferredEv = data.evs[index];
      }
      if (canOver && matchesHoldSelector(pattern, rule.over) &&
          (overMask < 0 || data.preferences[index] > data.preferences[h * 32 + overMask])) {
        overMask = mask; overEv = data.evs[index];
      }
    }
    if (preferredMask < 0 || overMask < 0) continue;
    const optimal = context.analysis.perHand.get(hands[h].id)!;
    if (Math.max(preferredEv, overEv) < optimal.ev - 1e-10) continue;
    if (rule.unless && unlessMatches(rule.unless,
      describeHoldUnchecked(hands[h].hand, preferredMask, context.analysis.familyId),
      describeHoldUnchecked(hands[h].hand, overMask, context.analysis.familyId))) continue;
    const loss = Math.max(0, optimal.ev - preferredEv);
    handsAffected += hands[h].weight; canonicalHandsAffected++;
    totalLoss += loss * hands[h].weight / 2598960;
    if (loss > 1e-10) {
      mistakeHands += hands[h].weight;
      counterexamples.push({
        canonicalHandId: hands[h].id, hand: [...hands[h].hand] as unknown as Hand,
        chosenMask: preferredMask, bestMask: optimal.bestMask, evLoss: loss, weight: hands[h].weight,
      });
    }
  }
  counterexamples.sort((a, b) => b.evLoss - a.evLoss || a.canonicalHandId - b.canonicalHandId);
  const costVsOptimal = totalLoss * 100 / context.analysis.betCoins;
  return {
    analysisKey, returnPct: context.analysis.returnPct - costVsOptimal, costVsOptimal,
    handsAffected, canonicalHandsAffected, realPlayFreq: handsAffected / 2598960, mistakeHands,
    counterexamples: counterexamples.slice(0, 20),
  };
}

