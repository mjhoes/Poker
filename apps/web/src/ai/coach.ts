import * as z from "zod/v4";
import { coachReportSchema, newId } from "@perfect-draw/shared";
import type { AiProvider, AiTier, Records, StatsQuery, StatsReportView } from "@perfect-draw/shared";
import { describeLabel } from "@perfect-draw/engine";
import { db, live } from "../data/db";
import { familyName } from "../components/UiHelpers";
import { findingText } from "../components/StatsContext";
import { checkNumbers, factNumbers } from "./explain-facts";
import { estimateCallCost, modelFor, modelInfo } from "./models";
import { runTask } from "./router";

/*
 * The AI coach report (F5.5, docs/19-CONTEXT-ANALYSIS-PLAN.md): written only from the Statistics report's computed
 * numbers. Every number in the reply must appear in the facts (as Explain checks); reports are saved with their facts.
 */

export const COACH_PROMPT_VERSION = 1;
export type CoachReport = Records["coachReports"];
export type CoachScope = CoachReport["scope"];

const pct = (value: number | null, digits = 1) => value === null ? null : Number(value.toFixed(digits));
const fixed = (value: number, digits: number) => Number(value.toFixed(digits));

/** The facts the coach is given: the scope, the overall figures, weaknesses, confusions, the recent trend and context. */
export function coachFacts(report: StatsReportView, scope: { payTable: string; summary: string }) {
  const name = (label: string) => describeLabel(label, report.familyId);
  const observed = report.categories.filter(category => category.n > 0);
  return {
    game: familyName(report.familyId), payTable: scope.payTable, scope: scope.summary, coinsBet: report.coins,
    firstAnswers: report.n, mistakes: report.errors, accuracyPct: pct(report.accuracyPct),
    evLostPer1000Hands: report.evLostPer1000 === null ? null : fixed(report.evLostPer1000, 2),
    optimalReturnPct: pct(report.optimalReturnPct, 3), returnAsPlayedPct: pct(report.asDrilledReturnPct, 3),
    biggestWeaknesses: observed.slice(0, 5).map(category => ({
      hand: name(category.label), decisions: category.n, mistakes: category.errors,
      errorRatePct: fixed(category.errorRate * 100, 1), avgLossPerMistake: fixed(category.avgEvLoss, 3),
    })),
    costliestConfusions: report.confusion.filter(row => row.errors > 0).sort((a, b) => b.evLostTotal - a.evLostTotal).slice(0, 3).map(row => ({
      bestHold: name(row.bestLabel), youHeld: name(row.chosenLabel), times: row.errors, evLostTotal: fixed(row.evLostTotal, 2),
    })),
    recentDays: report.trend.slice(-7).map(day => ({ day: new Date(day.at).toISOString().slice(0, 10), decisions: day.n, accuracyPct: fixed(day.accuracyPct, 1) })),
    whenMistakesHappen: report.context.n < report.context.minHands
      ? `Not enough recent hands to check (${report.context.n} of ${report.context.minHands}).`
      : report.context.findings.length ? report.context.findings.map(findingText)
        : "Checked decision time, hand in the session, pay table changes, the previous hand and the previous draw: nothing stands out beyond what the hands explain.",
    units: "EV and losses are in credits at this bet. Error rates and accuracy are percentages of first answers.",
    appFeatures: "Train page: today's review, Weakness Trainer, Close Calls, Strategy Ladder, Pay Table Switcher. Heuristics page: personal rule cards from your mistakes, and a printable strategy PDF. Statistics: Train this, for a focused Rapid Drill.",
  };
}
export type CoachFacts = ReturnType<typeof coachFacts>;

export const COACH_SYSTEM = [
  "You are a video poker coach writing a short report for one player from their own statistics.",
  "Use only the DATA. Every number you write must appear in the DATA exactly: don't calculate, round differently, compare with arithmetic or invent figures.",
  "Mention a situation from whenMistakesHappen only as the DATA states it; if nothing stands out, you may say so.",
  "Reply with JSON: {\"headline\": one sentence, \"wins\": 0-3 short sentences on what is going well, \"focus\": 1-3 short sentences on the costliest things to fix, \"plan\": 1-4 concrete next steps that use the appFeatures}.",
  "Plain, encouraging, specific. No gambling advice beyond playing the strategy correctly.",
].join("\n");
export const coachPrompt = (facts: CoachFacts) => `DATA:\n${JSON.stringify(facts, null, 2)}`;
const replySchema = z.object({ headline: z.string(), wins: z.array(z.string()), focus: z.array(z.string()), plan: z.array(z.string()) });
type Reply = z.infer<typeof replySchema>;

/** What a reply gets wrong, or null: list sizes, lengths, and numbers only from the facts. */
export function coachProblem(reply: Reply, facts: CoachFacts): string | null {
  if (!reply.headline.trim() || reply.headline.length > 300) return "headline must be one sentence under 300 characters.";
  if (reply.wins.length > 3) return "Give at most 3 wins.";
  if (reply.focus.length < 1 || reply.focus.length > 3) return "Give 1 to 3 focus items.";
  if (reply.plan.length < 1 || reply.plan.length > 4) return "Give 1 to 4 plan steps.";
  if ([...reply.wins, ...reply.focus, ...reply.plan].some(text => !text.trim() || text.length > 400)) return "Each item must be one or two sentences under 400 characters.";
  const bad = checkNumbers([reply.headline, ...reply.wins, ...reply.focus, ...reply.plan].join(" "), factNumbers(facts));
  return bad.length ? `Numbers not in the DATA: ${bad.join(", ")}. Use only numbers that appear in the DATA.` : null;
}

const TYPICAL_OUTPUT_TOKENS = 1400;

/** A report's scope from the Statistics page's query. */
export function coachScope(query: StatsQuery, summary: string): CoachScope {
  return {
    paytableId: query.paytableId, coins: query.coins ?? 5, mode: query.mode ?? "all",
    since: query.since ?? null, until: query.until ?? null, denominationCents: query.denominationCents ?? null, summary,
  };
}

export const coachService = {
  estimate(facts: CoachFacts, provider: AiProvider, tier: AiTier) {
    return estimateCallCost(modelFor(provider, tier).id, COACH_SYSTEM + coachPrompt(facts), TYPICAL_OUTPUT_TOKENS);
  },
  /** Saved reports for a pay table at a bet, newest first. */
  async list(paytableId: string, coins: number): Promise<CoachReport[]> {
    const rows = await db.records("coachReports").where("scope.paytableId").equals(paytableId).toArray();
    return rows.filter(row => live(row) && row.scope.coins === coins).map(row => coachReportSchema.parse(row)).sort((a, b) => b.createdAt - a.createdAt);
  },
  async remove(id: string) {
    await db.records("coachReports").delete(id);
  },
  /** Writes a report from the facts (one retry when a reply fails the checks; then nothing is saved), saves and returns it. */
  async write(options: { scope: CoachScope; facts: CoachFacts; provider: AiProvider; tier: AiTier }) {
    const result = await runTask({
      task: "coach_report", provider: options.provider, tier: options.tier, system: COACH_SYSTEM, prompt: coachPrompt(options.facts),
      schema: replySchema, check: reply => coachProblem(reply, options.facts),
    });
    const now = Date.now(), clean = (items: string[]) => items.map(item => item.trim()).filter(Boolean);
    const record = coachReportSchema.parse({
      id: newId(), createdAt: now, updatedAt: now, deletedAt: null, scope: options.scope, facts: options.facts,
      report: { headline: result.data.headline.trim(), wins: clean(result.data.wins), focus: clean(result.data.focus), plan: clean(result.data.plan) },
      provider: result.provider, model: modelInfo(result.model)?.id ?? result.model, promptVersion: COACH_PROMPT_VERSION,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, estCost: result.cost,
    });
    await db.records("coachReports").put(record);
    return { record, cost: result.cost, calls: result.calls };
  },
};
