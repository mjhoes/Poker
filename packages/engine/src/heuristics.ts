import { getCanonicalHands } from "./canonical";
import { getTrainingContext } from "./training";
import { ruleDeals, unlessMatches, validateRuleAST } from "./rules";
import type { RuleAST, RuleCondition, RuleDeal } from "./rules";
import type { Hand } from "./types";

/*
 * Personal heuristic cards (docs/17-HEURISTICS-PLAN.md): "hold A over B, unless X — then hold B", scored over every
 * deal. Unlike evaluateRule (which skips the deals an exception matches), a card always says what to hold: B when an
 * exception matches. It decides only the deals ruleDeals() finds (one of the two holds is a best play there).
 */

export interface HeuristicExample {
  readonly hand: Hand;
  /** The card's hold, and a best hold, on these cards. */
  readonly mask: number; readonly bestMask: number;
  /** EV given up by the card's hold (0 when it is a best play), in coins at the analysis' bet. */
  readonly evLoss: number;
  /** Real deals (out of 2,598,960) that are this deal up to suits. */
  readonly weight: number;
  /** Whether an exception picked the hold. */
  readonly exception: boolean;
}
export interface HeuristicScore {
  readonly analysisKey: string;
  /** EV given up by following the card, as a share of the table's return (percentage points). */
  readonly costPct: number;
  /** The same for the bare rule (always A): following it blindly. */
  readonly costWithoutExceptionsPct: number;
  /** Share of real deals the card decides, and of those where its hold is a best play. */
  readonly appliesFreq: number; readonly rightFreq: number;
  /** Share of real deals where an exception decides. */
  readonly exceptionFreq: number;
  /** The most common deals where the card is right: the rule's, then the exception's. */
  readonly examples: readonly HeuristicExample[];
  /** The deals where the card is wrong that cost the most (EV × frequency). */
  readonly counterexamples: readonly HeuristicExample[];
}

const TOTAL = 2598960;
const EPS = 1e-10;

function scoreDeals(rule: RuleAST, analysisKey: string, deals: readonly RuleDeal[]): HeuristicScore {
  const context = getTrainingContext(analysisKey), hands = getCanonicalHands();
  let loss = 0, blindLoss = 0, applies = 0, right = 0, excepted = 0;
  const rows: HeuristicExample[] = [];
  for (const deal of deals) {
    const exception = !!rule.unless && unlessMatches(rule.unless, deal.preferred, deal.over);
    const ev = exception ? deal.overEv : deal.preferredEv;
    const evLoss = Math.max(0, deal.bestEv - ev);
    loss += evLoss * deal.weight;
    blindLoss += Math.max(0, deal.bestEv - deal.preferredEv) * deal.weight;
    applies += deal.weight;
    if (evLoss <= EPS) right += deal.weight;
    if (exception) excepted += deal.weight;
    const held = (exception ? deal.over : deal.preferred).heldRanks;
    rows.push({ hand: [...hands[deal.h].hand] as unknown as Hand, mask: exception ? deal.overMask : deal.preferredMask, bestMask: deal.bestMask, evLoss: evLoss <= EPS ? 0 : evLoss, weight: deal.weight, exception, held } as HeuristicExample & { held: string });
  }
  const pct = (total: number) => total / TOTAL * 100 / context.analysis.betCoins;
  const byWeight = (a: HeuristicExample, b: HeuristicExample) => b.weight - a.weight || b.evLoss - a.evLoss;
  const rightRows = rows.filter(row => row.evLoss === 0);
  /** The first `count` rows, preferring ones that hold different ranks (near-copies teach nothing new). */
  const varied = (sorted: HeuristicExample[], count: number) => {
    const seen = new Set<string>(), picked: HeuristicExample[] = [];
    for (const row of sorted) {
      const held = (row as HeuristicExample & { held: string }).held;
      if (!seen.has(held)) { seen.add(held); picked.push(row); }
      if (picked.length === count) break;
    }
    for (const row of sorted) { if (picked.length >= count) break; if (!picked.includes(row)) picked.push(row); }
    return picked.map(({ hand, mask, bestMask, evLoss, weight, exception }) => ({ hand, mask, bestMask, evLoss, weight, exception }));
  };
  return {
    analysisKey, costPct: pct(loss), costWithoutExceptionsPct: pct(blindLoss),
    appliesFreq: applies / TOTAL, rightFreq: applies ? right / applies : 0, exceptionFreq: excepted / TOTAL,
    examples: [...varied(rightRows.filter(row => !row.exception).sort(byWeight), 3), ...varied(rightRows.filter(row => row.exception).sort(byWeight), 2)],
    counterexamples: varied(rows.filter(row => row.evLoss > 0).sort((a, b) => b.evLoss * b.weight - a.evLoss * a.weight || byWeight(a, b)), 5),
  };
}

/** A card's exact score over every deal (exceptions mean "hold the other one"). */
export function scoreHeuristic(rule: RuleAST, analysisKey: string): HeuristicScore {
  validateRuleAST(rule);
  return scoreDeals(rule, analysisKey, ruleDeals(rule, analysisKey));
}

/** The single conditions the exception search tries: a penalty on either hold, or a rank held or discarded by either. */
function candidateConditions(): RuleCondition[] {
  const result: RuleCondition[] = [];
  for (const on of ["preferred", "over"] as const) {
    for (const penalty of ["flush", "straight"] as const) result.push({ kind: "penalty", penalty, on });
    for (const rank of "23456789TJQKA") for (const where of ["held", "discarded"] as const) result.push({ kind: "rank", rank, in: where, on });
  }
  return result;
}

/** An exception must save at least this share of return (pp) and this fraction of what the card still costs. */
const MIN_GAIN_PCT = 0.0005, MIN_GAIN_SHARE = 0.1;

/**
 * The bare rule "hold A over B" plus up to `max` exceptions found greedily: each time, the condition whose deals would
 * lose least by holding B instead, if it saves enough. Returns the card's rule with its score and the bare rule's.
 */
export function suggestExceptions(rule: Pick<RuleAST, "prefer" | "over">, analysisKey: string, max = 2) {
  const bare: RuleAST = { kind: "prefer", prefer: rule.prefer, over: rule.over };
  validateRuleAST(bare);
  const context = getTrainingContext(analysisKey);
  const deals = ruleDeals(bare, analysisKey);
  const pct = (total: number) => total / TOTAL * 100 / context.analysis.betCoins;
  const chosen: RuleCondition[] = [];
  const excepted = new Uint8Array(deals.length);
  let cost = deals.reduce((sum, deal) => sum + Math.max(0, deal.bestEv - deal.preferredEv) * deal.weight, 0);
  const candidates = candidateConditions();
  while (chosen.length < max) {
    let best: RuleCondition | null = null, bestGain = 0;
    for (const condition of candidates) {
      if (chosen.includes(condition)) continue;
      let gain = 0;
      deals.forEach((deal, index) => {
        if (excepted[index] || !unlessMatches(condition, deal.preferred, deal.over)) return;
        gain += (Math.max(0, deal.bestEv - deal.preferredEv) - Math.max(0, deal.bestEv - deal.overEv)) * deal.weight;
      });
      if (gain > bestGain) { best = condition; bestGain = gain; }
    }
    if (!best || pct(bestGain) < MIN_GAIN_PCT || bestGain < cost * MIN_GAIN_SHARE) break;
    chosen.push(best);
    deals.forEach((deal, index) => { if (unlessMatches(best!, deal.preferred, deal.over)) excepted[index] = 1; });
    cost -= bestGain;
  }
  const card: RuleAST = chosen.length ? { ...bare, unless: chosen.length === 1 ? chosen[0] : { kind: "or", conditions: chosen } } : bare;
  return { rule: card, score: scoreDeals(card, analysisKey, deals), bare: scoreDeals(bare, analysisKey, deals) };
}
