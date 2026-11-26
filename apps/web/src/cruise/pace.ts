import type { Records } from "@perfect-draw/shared";
import { HOUR_MS, PRACTICE_IDLE_MS } from "./economics";

/*
 * Casino-Pace Mode's arithmetic (docs/14-CASINO-PACE-PLAN.md), pure and unit-tested. A hand's pace is the time since
 * the previous hand in the same session; a gap longer than a minute is a break, not a pace. Accuracy is "EV kept":
 * Σ EV of the holds chosen ÷ Σ EV of the best holds. What mistakes cost is in % of return (EV lost per coin bet), so
 * hands at different bets and games can be compared, and in $ per point (× the program's $ per point).
 */

export type PaceDecision = Pick<Records["decisions"], "sessionId" | "createdAt" | "isCorrection" | "chosenEv" | "bestEv" | "evLoss" | "coins">;
export const ACCURACY_CHOICES = [99.5, 99.8, 99.9, 99.95] as const;
export const DEFAULT_ACCURACY_PCT = 99.9;
export const BAND_EDGES = [500, 700, 900, 1100] as const;
/** A band needs this many hands before it can be anyone's best pace. */
export const MIN_BAND_HANDS = 50;
const RECENT = 20;

type Totals = { hands: number; chosenEv: number; bestEv: number; lossPctSum: number };
const empty = (): Totals => ({ hands: 0, chosenEv: 0, bestEv: 0, lossPctSum: 0 });
function add(totals: Totals, decision: PaceDecision) {
  totals.hands++; totals.chosenEv += decision.chosenEv; totals.bestEv += decision.bestEv;
  totals.lossPctSum += decision.evLoss / decision.coins * 100;
}
const evKept = (totals: Totals) => totals.bestEv > 0 ? Math.min(100, totals.chosenEv / totals.bestEv * 100) : null;
const errorCost = (totals: Totals) => totals.hands ? totals.lossPctSum / totals.hands : null;

/** Each session's first decisions (corrections left out), in time order. */
function bySession(decisions: readonly PaceDecision[]) {
  const sessions = new Map<string, PaceDecision[]>();
  for (const decision of decisions) if (!decision.isCorrection) sessions.set(decision.sessionId, [...sessions.get(decision.sessionId) ?? [], decision]);
  for (const rows of sessions.values()) rows.sort((a, b) => a.createdAt - b.createdAt);
  return sessions;
}
const rate = (gaps: readonly number[]) => {
  const ms = gaps.reduce((sum, gap) => sum + gap, 0);
  return gaps.length && ms > 0 ? gaps.length / (ms / HOUR_MS) : null;
};

/** One session's pace and accuracy: overall, and over the last 20 hands (what the meter shows while playing). */
export function sessionPace(decisions: readonly PaceDecision[], idleMs = PRACTICE_IDLE_MS) {
  const rows = [...bySession(decisions).values()].flat().sort((a, b) => a.createdAt - b.createdAt);
  const gaps: number[] = [];
  for (let index = 1; index < rows.length; index++) {
    const gap = rows[index].createdAt - rows[index - 1].createdAt;
    if (gap > 0 && gap <= idleMs) gaps.push(gap);
  }
  const totals = empty();
  for (const row of rows) add(totals, row);
  return {
    hands: rows.length, activeMs: gaps.reduce((sum, gap) => sum + gap, 0),
    handsPerHour: gaps.length >= 5 ? rate(gaps) : null,
    recentHandsPerHour: gaps.length >= 5 ? rate(gaps.slice(-RECENT)) : null,
    evKeptPct: evKept(totals), errorCostPct: errorCost(totals),
  };
}

export type PaceBand = {
  /** Lower and upper pace (hands/hr); `to` is null for the fastest band. */
  from: number; to: number | null;
  hands: number; meanHandsPerHour: number | null; evKeptPct: number | null; errorCostPct: number | null;
};
/** Hands grouped by the pace they were played at. Only hands that follow another within a minute have a pace. */
export function paceBands(decisions: readonly PaceDecision[], idleMs = PRACTICE_IDLE_MS): PaceBand[] {
  const edges = [0, ...BAND_EDGES];
  const bands = edges.map((from, index) => ({ from, to: edges[index + 1] ?? null, totals: empty(), paces: [] as number[] }));
  for (const rows of bySession(decisions).values()) {
    for (let index = 1; index < rows.length; index++) {
      const gap = rows[index].createdAt - rows[index - 1].createdAt;
      if (gap <= 0 || gap > idleMs) continue;
      const pace = HOUR_MS / gap;
      const band = [...bands].reverse().find(item => pace >= item.from)!;
      add(band.totals, rows[index]);
      band.paces.push(pace);
    }
  }
  return bands.map(band => ({
    from: band.from, to: band.to, hands: band.totals.hands,
    // The harmonic mean: total hands over total time, the pace those hands were actually played at.
    meanHandsPerHour: band.paces.length ? band.paces.length / band.paces.reduce((sum, pace) => sum + 1 / pace, 0) : null,
    evKeptPct: evKept(band.totals), errorCostPct: errorCost(band.totals),
  }));
}

/** The fastest band with enough hands that keeps the accuracy bar; null if none does yet. */
export function bestPace(bands: readonly PaceBand[], accuracyPct: number, minHands = MIN_BAND_HANDS) {
  return [...bands].reverse().find(band => band.hands >= minHands && band.evKeptPct !== null && band.evKeptPct + 1e-9 >= accuracyPct) ?? null;
}

/** Extra cost of a point from mistakes: $ per point × the share of return they cost. */
export const mistakeCostPerPointCents = (dollarsPerPoint: number, errorCostPct: number) => dollarsPerPoint * 100 * errorCostPct / 100;

/** The pace a trip needs: hands for the points still needed at this bet, over the casino hours left. */
export function neededPace(pointsNeeded: number, dollarsPerPoint: number, betCents: number, hoursLeft: number) {
  if (pointsNeeded <= 0 || hoursLeft <= 0 || betCents <= 0) return null;
  return pointsNeeded * dollarsPerPoint * 100 / betCents / hoursLeft;
}
