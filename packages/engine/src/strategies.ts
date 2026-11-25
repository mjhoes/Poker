import { getCanonicalHands } from "./canonical";
import { describeHoldUnchecked, holdSuitPattern, refinementKey } from "./labels";
import { getTrainingContext } from "./training";
import { boundedChart } from "./chart-optimizer";
import { strategyMeetsTarget } from "./strategy-targets";
import { canonicalMaskOrder, CHART_TIE_RULE, holdPreference, isChartLabel, preferHold } from "./hold-policy";
import { chartSections, deuceSection } from "./chart-sections";
import type { StrategySection } from "./chart-sections";
import type { GameFamilyId, HandAnalysis } from "./types";
import type { TrainingContext } from "./training";

export const STRATEGY_TIERS = ["Beginner", "Intermediate", "Expert", "Reference", "Perfect"] as const;
export const MEMORIZABLE_STRATEGY_TIERS = ["Beginner", "Intermediate", "Expert"] as const;
export type StrategyTier = typeof STRATEGY_TIERS[number];
export interface StrategyException {
  readonly prefer: string;
  readonly heldRanks: string;
  readonly discardedRanks: string;
  readonly flushPenalty: number;
  readonly straightPenalty: number;
  /** Only needed when rank/penalty conditions still give conflicting advice. */
  readonly suitPattern?: string;
}
export interface StrategyLine {
  readonly label: string;
  /** Printed, ordered level-0 subrules. The first matching alternative wins. */
  readonly alternatives?: readonly string[];
  readonly rank: number;
  readonly exceptions: readonly StrategyException[];
  /** Real-deal frequency on which this line supplies the chosen hold. */
  readonly freq: number;
  /** Percentage points lost if this line is omitted from this same list. */
  readonly costIfIgnored: number | null;
}
export interface StrategyList {
  readonly analysisKey: string;
  readonly familyId: GameFamilyId;
  readonly tier: StrategyTier;
  readonly refinement: 0 | 1 | 2;
  readonly lines: readonly StrategyLine[];
  readonly returnPct: number;
  readonly costVsOptimal: number;
  readonly optimalDecisionFreq: number;
  readonly meetsTarget: boolean;
  readonly forMemorization: boolean;
  readonly tieBreakRule: string;
  readonly sections?: readonly StrategySection[];
}

interface Score {
  returnPct: number;
  optimalDecisionFreq: number;
  frequencies: Float64Array;
  withoutLoss: Float64Array;
}

function candidates(context: TrainingContext, level: 0 | 1 | 2): number[] {
  const data = context.getData();
  const hands = getCanonicalHands();
  const result = new Set<number>();
  for (let h = 0; h < hands.length; h++) {
    const best = context.analysis.perHand.get(hands[h].id)!;
    const code = data.labels[level][h * 32 + best.bestMask];
    if (isChartLabel(data.names[level][code])) result.add(code);
  }
  result.add(data.labels[level][0]); // DRAW5 is always available.
  return [...result].sort((a, b) => data.names[level][a].localeCompare(data.names[level][b]));
}

type ExceptionMap = ReadonlyMap<number, readonly StrategyException[]>;
type RuleSignature = Pick<StrategyException, "heldRanks" | "discardedRanks" | "flushPenalty" | "straightPenalty">;
const signature = (pattern: RuleSignature) =>
  `${pattern.heldRanks}/${pattern.discardedRanks}/${pattern.flushPenalty}/${pattern.straightPenalty}`;
type CompiledCondition = { generic?: number; suits?: Map<string, number> };
type CompiledExceptions = Map<number, Map<number, Map<string, CompiledCondition>>>;
const compiledExceptions = new WeakMap<object, CompiledExceptions>();

function compileExceptions(context: TrainingContext, level: 0 | 1 | 2, exceptions: ExceptionMap): CompiledExceptions {
  const previous = compiledExceptions.get(exceptions);
  if (previous) return previous;
  const result: CompiledExceptions = new Map();
  const names = new Map(context.getData().names[level].map((name, index) => [name, index]));
  for (const [over, rules] of exceptions) {
    const byPreferred = new Map<number, Map<string, CompiledCondition>>();
    rules.forEach((rule, index) => {
      if (!isChartLabel(rule.prefer)) return;
      const preferred = names.get(rule.prefer);
      if (preferred === undefined) throw new Error("Exception references an unknown strategy category.");
      const conditions = byPreferred.get(preferred) ?? new Map<string, CompiledCondition>();
      const condition = conditions.get(signature(rule)) ?? {};
      if (rule.suitPattern !== undefined) {
        condition.suits ??= new Map();
        if (!condition.suits.has(rule.suitPattern)) condition.suits.set(rule.suitPattern, index);
      } else if (condition.generic === undefined) condition.generic = index;
      conditions.set(signature(rule), condition);
      byPreferred.set(preferred, conditions);
    });
    result.set(over, byPreferred);
  }
  compiledExceptions.set(exceptions, result);
  return result;
}

function applyExceptions(context: TrainingContext, h: number, level: 0 | 1 | 2, chosenMask: number, exceptions?: ExceptionMap): number {
  if (!exceptions?.size) return chosenMask;
  const data = context.getData(), hand = getCanonicalHands()[h].hand;
  const rules = compileExceptions(context, level, exceptions).get(data.labels[level][h * 32 + chosenMask]);
  if (!rules) return chosenMask;
  let selected = chosenMask, ruleRank = Infinity, preference = -Infinity;
  for (let mask = 0; mask < 32; mask++) {
    const conditions = rules.get(data.labels[level][h * 32 + mask]);
    if (!conditions) continue;
    const pattern = describeHoldUnchecked(hand, mask, context.analysis.familyId);
    const condition = conditions.get(signature(pattern));
    if (!condition) continue;
    const suitedRank = condition.suits?.get(holdSuitPattern(hand, mask));
    const rank = Math.min(condition.generic ?? Infinity, suitedRank ?? Infinity);
    if (Number.isFinite(rank) && (rank < ruleRank || rank === ruleRank && data.preferences[h * 32 + mask] > preference)) {
      selected = mask; ruleRank = rank; preference = data.preferences[h * 32 + mask];
    }
  }
  return selected;
}

function score(context: TrainingContext, level: 0 | 1 | 2, order: readonly number[], exceptions?: ExceptionMap, groups?: readonly (readonly number[])[]): Score {
  const data = context.getData(), hands = getCanonicalHands(), names = data.names[level];
  const priority = new Int32Array(names.length).fill(-1);
  order.forEach((code, rank) => { priority[code] = rank; });
  const grouped = groups ?? order.map(code => [code]);
  const groupOf = new Int32Array(names.length);
  grouped.forEach((codes, group) => codes.forEach(code => { groupOf[code] = group; }));
  const generic = level === 2 ? names.map(name => names.indexOf(name.split("|")[0])) : [];
  const frequencies = new Float64Array(grouped.length), withoutLoss = new Float64Array(grouped.length);
  let mean = 0, optimalWeight = 0;
  for (let h = 0; h < hands.length; h++) {
    let chosenRank = Infinity, nextRank = Infinity;
    let chosenEv = -Infinity, nextEv = -Infinity, chosenMask = -1, nextMask = -1, chosenGroup = -1;
    for (let mask = 0; mask < 32; mask++) {
      const index = h * 32 + mask, code = data.labels[level][index], ev = data.evs[index];
      // Retain the generic match as an omission alternative even when the
      // same hold currently wins through a higher-priority penalty line.
      for (let alternative = 0; alternative < (level === 2 ? 2 : 1); alternative++) {
        const matching = alternative ? generic[code] : code;
        const rank = priority[matching], group = groupOf[matching];
        if (rank < 0) continue;
        if (rank < chosenRank) {
          if (group !== chosenGroup) { nextRank = chosenRank; nextEv = chosenEv; nextMask = chosenMask; }
          chosenRank = rank; chosenEv = ev; chosenMask = mask; chosenGroup = group;
        } else if (rank === chosenRank) {
          if (data.preferences[index] > data.preferences[h * 32 + chosenMask]) { chosenEv = ev; chosenMask = mask; }
        }
        else if (group !== chosenGroup && rank < nextRank) { nextRank = rank; nextEv = ev; nextMask = mask; }
        else if (group !== chosenGroup && rank === nextRank && data.preferences[index] > data.preferences[h * 32 + nextMask]) { nextEv = ev; nextMask = mask; }
      }
    }
    if (!Number.isFinite(chosenEv)) throw new Error("Strategy must contain DRAW5 as a total fallback.");
    const corrected = applyExceptions(context, h, level, chosenMask, exceptions);
    if (corrected !== chosenMask) chosenEv = data.evs[h * 32 + corrected];
    const { weight, id } = hands[h];
    const optimal = context.analysis.perHand.get(id)!.ev;
    mean += chosenEv * weight / 2598960;
    if (Math.abs(optimal - chosenEv) < 1e-10) optimalWeight += weight;
    frequencies[chosenGroup] += weight / 2598960;
    // A removed DRAW5 line has no alternative when it was the only match.
    if (nextMask >= 0) {
      nextEv = data.evs[h * 32 + applyExceptions(context, h, level, nextMask, exceptions)];
      withoutLoss[chosenGroup] += (chosenEv - nextEv) * weight / 2598960;
    }
  }
  return {
    returnPct: mean * 100 / context.analysis.betCoins,
    optimalDecisionFreq: optimalWeight / 2598960, frequencies, withoutLoss,
  };
}

/** Frequency/gap-weighted precedence graph, with deterministic cycle breaking. */
function graphOrder(context: TrainingContext, level: 0 | 1 | 2): number[] {
  const data = context.getData(), hands = getCanonicalHands();
  const codes = candidates(context, level), n = codes.length;
  const local = new Int32Array(data.names[level].length).fill(-1);
  codes.forEach((code, i) => { local[code] = i; });
  const evidence = new Float64Array(n * n), incoming = new Float64Array(n);
  const evs = new Float64Array(n), stamps = new Int32Array(n).fill(-1);
  const masks = new Uint8Array(n);
  const totals = new Float64Array(n), frequencies = new Float64Array(n);
  const present: number[] = [];
  for (let h = 0; h < hands.length; h++) {
    present.length = 0;
    for (let mask = 0; mask < 32; mask++) {
      const index = h * 32 + mask, label = local[data.labels[level][index]];
      if (label < 0) continue;
      if (stamps[label] !== h) { stamps[label] = h; evs[label] = data.evs[index]; masks[label] = mask; present.push(label); }
      else if (data.preferences[index] > data.preferences[h * 32 + masks[label]]) { masks[label] = mask; evs[label] = data.evs[index]; }
    }
    for (const a of present) {
      frequencies[a] += hands[h].weight;
      totals[a] += hands[h].weight * evs[a];
      for (const b of present) if (evs[a] > evs[b]) {
        evidence[a * n + b] += hands[h].weight * (evs[a] - evs[b]);
      }
    }
  }
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const net = evidence[a * n + b] - evidence[b * n + a];
    evidence[a * n + b] = Math.max(0, net);
    evidence[b * n + a] = Math.max(0, -net);
    if (net > 0) incoming[b] += net;
    else incoming[a] -= net;
  }
  const remaining = new Set(Array.from({ length: n }, (_, i) => i)), result: number[] = [];
  while (remaining.size) {
    let best = -1;
    for (const candidate of remaining) {
      if (best < 0 || incoming[candidate] < incoming[best] - 1e-8 ||
          (Math.abs(incoming[candidate] - incoming[best]) < 1e-8 &&
           totals[candidate] / frequencies[candidate] > totals[best] / frequencies[best])) best = candidate;
    }
    result.push(codes[best]);
    remaining.delete(best);
    for (const other of remaining) incoming[other] = Math.max(0, incoming[other] - evidence[best * n + other]);
  }
  // Never choose DRAW5 before a line which is intended to improve it.
  const fallback = data.labels[level][0];
  const ordered = result.filter(code => code !== fallback);
  if (context.analysis.familyId === "deuces_wild") ordered.sort((a, b) => deuceSection(data.names[level][a]) - deuceSection(data.names[level][b]));
  return [...ordered, fallback];
}

/** Split conflicting precedence by explicit rank/penalty conditions, not hand IDs. */
function learnExceptions(context: TrainingContext, order: readonly number[]): Map<number, StrategyException[]> {
  const data = context.getData(), hands = getCanonicalHands(), names = data.names[1];
  const priority = new Int32Array(names.length).fill(-1);
  order.forEach((code, rank) => { priority[code] = rank; });
  type Proposal = { over: number; rule: StrategyException; gain: number };
  const proposed = new Map<string, Proposal>();
  const chosen = new Uint8Array(hands.length);
  for (let h = 0; h < hands.length; h++) {
    let bestRank = Infinity, bestEv = -Infinity;
    for (let mask = 0; mask < 32; mask++) {
      const index = h * 32 + mask, rank = priority[data.labels[1][index]];
      if (rank >= 0 && (rank < bestRank || rank === bestRank && data.preferences[index] > data.preferences[h * 32 + chosen[h]])) {
        chosen[h] = mask; bestRank = rank; bestEv = data.evs[index];
      }
    }
    const optimal = context.analysis.perHand.get(hands[h].id)!;
    if (optimal.ev - bestEv < 1e-10) continue;
    if (!isChartLabel(names[data.labels[1][h * 32 + optimal.bestMask]])) continue;
    const pattern = describeHoldUnchecked(hands[h].hand, optimal.bestMask, context.analysis.familyId);
    const over = data.labels[1][h * 32 + chosen[h]];
    const rule: StrategyException = {
      prefer: names[data.labels[1][h * 32 + optimal.bestMask]],
      heldRanks: pattern.heldRanks, discardedRanks: pattern.discardedRanks,
      flushPenalty: pattern.flushPenalty, straightPenalty: pattern.straightPenalty,
    };
    const key = `${over}:${JSON.stringify(rule)}`;
    if (!proposed.has(key)) proposed.set(key, { over, rule, gain: 0 });
  }
  // Validate each contextual split against *all* matching hands, not just its
  // discovery examples. This prevents overfitting a rule to one counterexample.
  const byOver = new Map<number, Map<number, Map<string, Proposal>>>();
  const nameCodes = new Map(names.map((name, code) => [name, code]));
  for (const proposal of proposed.values()) {
    const preferredCode = nameCodes.get(proposal.rule.prefer)!;
    const byPreferred = byOver.get(proposal.over) ?? new Map<number, Map<string, Proposal>>();
    const conditions = byPreferred.get(preferredCode) ?? new Map<string, Proposal>();
    conditions.set(signature(proposal.rule), proposal);
    byPreferred.set(preferredCode, conditions); byOver.set(proposal.over, byPreferred);
  }
  const matching = new Map<Proposal, number>();
  for (let h = 0; h < hands.length; h++) {
    const over = data.labels[1][h * 32 + chosen[h]], proposals = byOver.get(over);
    if (!proposals) continue;
    matching.clear();
    for (let mask = 0; mask < 32; mask++) {
      const index = h * 32 + mask, conditions = proposals.get(data.labels[1][index]);
      if (!conditions) continue;
      const pattern = describeHoldUnchecked(hands[h].hand, mask, context.analysis.familyId);
      const proposal = conditions.get(signature(pattern));
      if (proposal) {
        const previous = matching.get(proposal);
        if (previous === undefined || data.preferences[index] > data.preferences[h * 32 + previous]) matching.set(proposal, mask);
      }
    }
    for (const [proposal, mask] of matching) proposal.gain += (data.evs[h * 32 + mask] - data.evs[h * 32 + chosen[h]]) * hands[h].weight;
  }
  const result = new Map<number, StrategyException[]>();
  for (const proposal of [...proposed.values()].filter(item => item.gain > 1e-9).sort((a, b) => b.gain - a.gain)) {
    const list = result.get(proposal.over) ?? [];
    list.push(proposal.rule); result.set(proposal.over, list);
  }
  let residualWeight = 0, residualLoss = 0;
  const specific = new Map<number, StrategyException[]>();
  for (let h = 0; h < hands.length; h++) {
    const selected = applyExceptions(context, h, 1, chosen[h], result);
    const optimal = context.analysis.perHand.get(hands[h].id)!;
    const loss = optimal.ev - data.evs[h * 32 + selected];
    if (loss < 1e-10) continue;
    if (!isChartLabel(names[data.labels[1][h * 32 + optimal.bestMask]])) continue;
    residualWeight += hands[h].weight;
    residualLoss += loss * hands[h].weight / 2598960;
    const pattern = describeHoldUnchecked(hands[h].hand, optimal.bestMask, context.analysis.familyId);
    const over = data.labels[1][h * 32 + chosen[h]];
    const rules = specific.get(over) ?? [];
    rules.push({
      prefer: names[data.labels[1][h * 32 + optimal.bestMask]],
      heldRanks: pattern.heldRanks, discardedRanks: pattern.discardedRanks,
      flushPenalty: pattern.flushPenalty, straightPenalty: pattern.straightPenalty,
      suitPattern: holdSuitPattern(hands[h].hand, optimal.bestMask),
    });
    specific.set(over, rules);
  }
  if (residualWeight / 2598960 <= 0.001 && residualLoss * 100 / context.analysis.betCoins <= 0.02) return result;
  // Refine only unresolved rank/penalty conflicts. These are explicit card/suit
  // predicates, never canonical-hand-ID lookups or an optimal-engine fallback.
  const refined = new Map(result);
  for (const [over, rules] of specific) refined.set(over, [...rules, ...(result.get(over) ?? [])]);
  return refined;
}

export function generateStrategyList(analysisKey: string, tier: StrategyTier): StrategyList {
  if (!STRATEGY_TIERS.includes(tier)) throw new Error("Unknown strategy tier.");
  const context = getTrainingContext(analysisKey);
  if (tier === "Perfect") return {
    analysisKey, familyId: context.analysis.familyId, tier, refinement: 1, lines: [], returnPct: context.analysis.returnPct,
    costVsOptimal: 0, optimalDecisionFreq: 1, meetsTarget: true, forMemorization: false,
    tieBreakRule: CHART_TIE_RULE,
  };
  const baseOrder = graphOrder(context, 0);
  const bounded = tier === "Beginner" || tier === "Expert"
    ? boundedChart(context, tier, baseOrder.map(code => context.getData().names[0][code])) : undefined;
  const level = bounded?.refinement ?? (tier === "Reference" ? 1 : 0);
  const groups = bounded?.groups.map(group => group.map(name => context.getData().names[level].indexOf(name)))
    ?? graphOrder(context, level).map(code => [code]);
  const order = groups.flat();
  const exceptions = tier === "Reference" ? learnExceptions(context, order) : new Map<number, StrategyException[]>();
  const result = score(context, level, order, exceptions, groups);
  const gap = Math.max(0, context.analysis.returnPct - result.returnPct);
  const list: StrategyList = {
    analysisKey, familyId: context.analysis.familyId, tier, refinement: level, returnPct: result.returnPct,
    costVsOptimal: gap,
    meetsTarget: false,
    optimalDecisionFreq: result.optimalDecisionFreq,
    forMemorization: tier !== "Reference",
    tieBreakRule: CHART_TIE_RULE,
    lines: groups.map((codes, rank) => ({
      label: codes.map(code => context.getData().names[level][code]).join(" / "), rank,
      ...(codes.length > 1 ? { alternatives: codes.map(code => context.getData().names[level][code]) } : {}),
      exceptions: exceptions.get(codes[0]) ?? [],
      freq: result.frequencies[rank],
      costIfIgnored: rank === groups.length - 1 ? null : result.withoutLoss[rank] * 100 / context.analysis.betCoins,
    })),
  };
  return { ...list, sections: chartSections(list.familyId, list.lines), meetsTarget: strategyMeetsTarget(list) };
}

/** What a strategy chart picks for a hand, and which line of the chart picks it (for citing the chart). */
export interface StrategyChoice {
  readonly mask: number;
  /** Index into `list.lines`; null when no line applies (discard all five) or for the Perfect tier. */
  readonly line: number | null;
  /** The line's exception that changed the pick, if one applied. */
  readonly exception: StrategyException | null;
}

export function selectStrategyHold(analysis: HandAnalysis, list: StrategyList): number {
  return strategyChoice(analysis, list).mask;
}

export function strategyChoice(analysis: HandAnalysis, list: StrategyList): StrategyChoice {
  const context = getTrainingContext(list.analysisKey);
  if (analysis.familyId !== context.analysis.familyId) throw new Error("Strategy and hand use different families.");
  if (JSON.stringify(analysis.valueVector) !== JSON.stringify(context.analysis.valueVector)) {
    throw new Error("Strategy and hand use different payout vectors.");
  }
  if (list.tier === "Perfect") return { mask: analysis.best.mask, line: null, exception: null };
  const flat = list.lines.flatMap((line, index) => (line.alternatives ?? [line.label]).map(label => ({ label, index })));
  const priority = new Map(flat.map(({ label }, rank) => [label, rank]));
  let chosen = -1, bestPriority = Infinity, bestPreference = -Infinity;
  const maskOrder = canonicalMaskOrder(analysis.hand);
  for (const hold of analysis.results) {
    const pattern = describeHoldUnchecked(analysis.hand, hold.mask, analysis.familyId);
    if (!isChartLabel(pattern.base)) continue;
    const key = refinementKey(pattern, list.refinement);
    const specific = priority.get(key), generic = list.refinement === 2 ? priority.get(pattern.base) : undefined;
    const rank = specific === undefined ? generic : generic === undefined ? specific : Math.min(specific, generic);
    if (rank === undefined) continue;
    const preference = holdPreference(pattern);
    if (rank < bestPriority || rank === bestPriority && (preference > bestPreference ||
        preference === bestPreference && maskOrder[hold.mask] < maskOrder[chosen])) {
      chosen = hold.mask; bestPriority = rank; bestPreference = preference;
    }
  }
  if (chosen < 0) return { mask: 0, line: null, exception: null }; // No named rule: discard five, never an unnamed EV winner.
  const lineIndex = flat[bestPriority]?.index ?? null;
  const selectedPattern = describeHoldUnchecked(analysis.hand, chosen, analysis.familyId);
  const selectedLine = list.lines.find(line => line.label === refinementKey(selectedPattern, list.refinement));
  for (const rule of selectedLine?.exceptions ?? []) {
    if (!isChartLabel(rule.prefer)) continue;
    const matches = analysis.results.filter(hold => {
      const pattern = describeHoldUnchecked(analysis.hand, hold.mask, analysis.familyId);
      return refinementKey(pattern, list.refinement) === rule.prefer && pattern.heldRanks === rule.heldRanks &&
        pattern.discardedRanks === rule.discardedRanks && pattern.flushPenalty === rule.flushPenalty &&
        pattern.straightPenalty === rule.straightPenalty &&
        (rule.suitPattern === undefined || holdSuitPattern(analysis.hand, hold.mask) === rule.suitPattern);
    });
    if (matches.length) {
      const mask = matches.reduce((best, hold) => preferHold(analysis.hand, hold.mask, best, analysis.familyId) ? hold.mask : best, -1);
      return { mask, line: lineIndex, exception: rule };
    }
  }
  return { mask: chosen, line: lineIndex, exception: null };
}
