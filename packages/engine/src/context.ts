/*
 * Context analysis (F5.4, docs/19-CONTEXT-ANALYSIS-PLAN.md): when mistakes happen, compared with what the hands
 * themselves would explain. Each decision's expected chance of a mistake is the player's own error rate on its hand type
 * (best-hold category), shrunk toward their overall rate and leaving the decision itself out; a situation's expected
 * mistakes are the sum over its hands. A difference counts only when its 95% interval excludes zero and the situation
 * has enough hands.
 */

/** One graded decision with what context analysis reads. `inScope`: in the report being shown (the rest give timing). */
export interface ContextDecision {
  sessionId: string; paytableId: string; createdAt: number;
  bestLabel: string; evLoss: number;
  decisionMs: number; handIndexInSession: number; priorOutcome: string | null;
  /** A first answer: not a correction or a later attempt at the same hand. */
  firstAnswer: boolean;
  mode: "free_play" | "drill";
  /** In a Pay Table Switcher session, which changes table on purpose. */
  switcherSession: boolean;
  inScope: boolean;
}
export interface ContextBucket {
  id: string; label: string;
  n: number; errors: number; expected: number;
  ratePct: number; expectedRatePct: number;
  /** Mistakes per 100 hands beyond (or, when negative, below) what these hands would explain, and its 95% half-width. */
  excessPer100: number; ciPer100: number;
  /** EV lost per 100 hands, and what these hands would cost at the player's usual rates (credits). */
  lossPer100: number; expectedLossPer100: number;
  /** Enough hands and an interval that excludes zero. */
  counts: boolean;
}
export interface ContextFactor { id: ContextFactorId; title: string; note: string; buckets: ContextBucket[] }
export interface ContextFinding {
  factor: ContextFactorId; factorTitle: string; bucket: string; bucketLabel: string;
  n: number; excessPer100: number; ciPer100: number; worse: boolean;
}
export interface ContextReport {
  /** First answers analyzed, and their mistakes. */
  n: number; errors: number;
  minHands: number;
  factors: ContextFactor[];
  /** Situations whose difference counts, the clearest first. */
  findings: ContextFinding[];
}
export type ContextFactorId = "decision_time" | "hand_in_session" | "table_change" | "previous_hand" | "previous_draw";

export const CONTEXT_MIN_HANDS = 30;
/** How many hands' worth the overall rate counts for when estimating a hand type's rate. */
export const CONTEXT_SHRINK = 5;
/** A previous decision on another pay table within this long makes the next hands "after changing pay table". */
export const CONTEXT_SWITCH_WINDOW_MS = 4 * 3_600_000;
export const CONTEXT_SWITCH_HANDS = 10;
const Z95 = 1.959964;
const BIG_WINS = new Set(["ROYAL_FLUSH", "NATURAL_ROYAL", "WILD_ROYAL", "FOUR_DEUCES", "FIVE_KIND", "STRAIGHT_FLUSH",
  "FOUR_KIND", "FOUR_ACES", "FOUR_234", "FOUR_5K", "FOUR_ACES_W_234", "FOUR_234_W_A234"]);
const isMistake = (decision: Pick<ContextDecision, "evLoss">) => decision.evLoss > 1e-9;

type Factor = { id: ContextFactorId; title: string; note: string; buckets: { id: string; label: string }[] };
const FACTORS: Factor[] = [
  { id: "decision_time", title: "Decision time", note: "How long you took to choose your hold.",
    buckets: [{ id: "under_2s", label: "Under 2 seconds" }, { id: "2_5s", label: "2–5 seconds" }, { id: "5_10s", label: "5–10 seconds" }, { id: "10s_plus", label: "10 seconds or more" }] },
  { id: "hand_in_session", title: "Hand in the session", note: "How far into a session the hand was.",
    buckets: [{ id: "1_25", label: "Hands 1–25" }, { id: "26_100", label: "Hands 26–100" }, { id: "101_300", label: "Hands 101–300" }, { id: "301_plus", label: "Hand 301 or later" }] },
  { id: "table_change", title: "After changing pay table", note: `The first ${CONTEXT_SWITCH_HANDS} hands after your previous hand, within 4 hours, was on another pay table. Pay Table Switcher hands are left out.`,
    buckets: [{ id: "first_hands", label: `First ${CONTEXT_SWITCH_HANDS} hands after a change` }, { id: "later", label: "Other hands" }] },
  { id: "previous_hand", title: "Previous hand", note: "Whether your previous answer in the same session was right.",
    buckets: [{ id: "after_mistake", label: "After a mistake" }, { id: "after_right", label: "After a right answer" }] },
  { id: "previous_draw", title: "Previous draw", note: "Free Play: how the previous draw paid.",
    buckets: [{ id: "after_loss", label: "After a losing draw" }, { id: "after_win", label: "After a win" }, { id: "after_big_win", label: "After four of a kind or better" }] },
];

/** Which bucket of each factor a decision falls in (undefined: not part of that factor). */
type Placement = Partial<Record<ContextFactorId, string>>;

function place(decision: ContextDecision, previousInSession: ContextDecision | undefined, sinceChange: number | null): Placement {
  const at: Placement = {};
  const ms = decision.decisionMs;
  at.decision_time = ms < 2000 ? "under_2s" : ms < 5000 ? "2_5s" : ms < 10_000 ? "5_10s" : "10s_plus";
  const hand = decision.handIndexInSession;
  at.hand_in_session = hand <= 25 ? "1_25" : hand <= 100 ? "26_100" : hand <= 300 ? "101_300" : "301_plus";
  if (!decision.switcherSession) at.table_change = sinceChange !== null && sinceChange <= CONTEXT_SWITCH_HANDS ? "first_hands" : "later";
  if (previousInSession) at.previous_hand = isMistake(previousInSession) ? "after_mistake" : "after_right";
  if (decision.mode === "free_play" && decision.priorOutcome && decision.priorOutcome !== "correct" && decision.priorOutcome !== "mistake") {
    const ranks = decision.priorOutcome.split(",");
    at.previous_draw = ranks.some(rank => BIG_WINS.has(rank)) ? "after_big_win" : ranks.some(rank => rank !== "NOTHING") ? "after_win" : "after_loss";
  }
  return at;
}

export function analyzeContext(decisions: readonly ContextDecision[]): ContextReport {
  const answers = decisions.filter(decision => decision.firstAnswer)
    .map((decision, order) => ({ decision, order }))
    .sort((a, b) => a.decision.createdAt - b.decision.createdAt || a.order - b.order)
    .map(item => item.decision);
  // Timing from every first answer, in time order: the previous one in the same session, and hands since a table change.
  const lastInSession = new Map<string, ContextDecision>();
  const placed: { decision: ContextDecision; at: Placement }[] = [];
  let previous: ContextDecision | undefined, sinceChange: number | null = null;
  for (const decision of answers) {
    if (previous && previous.paytableId !== decision.paytableId && decision.createdAt - previous.createdAt <= CONTEXT_SWITCH_WINDOW_MS) sinceChange = 1;
    else if (sinceChange !== null && previous && previous.paytableId === decision.paytableId) sinceChange++;
    else if (previous && previous.paytableId !== decision.paytableId) sinceChange = null; // a change after a long break
    if (decision.inScope) placed.push({ decision, at: place(decision, lastInSession.get(decision.sessionId), sinceChange) });
    lastInSession.set(decision.sessionId, decision);
    previous = decision;
  }

  // Each hand type's mistake rate and loss, shrunk toward the overall rate, without the decision itself.
  const n = placed.length;
  const errors = placed.reduce((sum, { decision }) => sum + (isMistake(decision) ? 1 : 0), 0);
  const lossTotal = placed.reduce((sum, { decision }) => sum + (isMistake(decision) ? decision.evLoss : 0), 0);
  const overallRate = n ? errors / n : 0, overallLoss = n ? lossTotal / n : 0;
  const byType = new Map<string, { n: number; errors: number; loss: number }>();
  for (const { decision } of placed) {
    const type = byType.get(decision.bestLabel) ?? { n: 0, errors: 0, loss: 0 };
    type.n++; type.errors += isMistake(decision) ? 1 : 0; type.loss += isMistake(decision) ? decision.evLoss : 0;
    byType.set(decision.bestLabel, type);
  }
  const expectation = ({ decision }: (typeof placed)[number]) => {
    const type = byType.get(decision.bestLabel)!, mine = isMistake(decision);
    const others = type.n - 1 + CONTEXT_SHRINK;
    return {
      p: (type.errors - (mine ? 1 : 0) + CONTEXT_SHRINK * overallRate) / others,
      loss: (type.loss - (mine ? decision.evLoss : 0) + CONTEXT_SHRINK * overallLoss) / others,
    };
  };

  const factors: ContextFactor[] = FACTORS.map(factor => ({
    id: factor.id, title: factor.title, note: factor.note,
    buckets: factor.buckets.map(bucket => {
      const members = placed.filter(item => item.at[factor.id] === bucket.id);
      let observed = 0, expected = 0, variance = 0, loss = 0, expectedLoss = 0;
      for (const item of members) {
        const { p, loss: typical } = expectation(item);
        observed += isMistake(item.decision) ? 1 : 0; expected += p; variance += p * (1 - p);
        loss += isMistake(item.decision) ? item.decision.evLoss : 0; expectedLoss += typical;
      }
      const count = members.length, per100 = (value: number) => count ? value / count * 100 : 0;
      const half = Z95 * Math.sqrt(variance);
      return {
        id: bucket.id, label: bucket.label, n: count, errors: observed, expected,
        ratePct: per100(observed), expectedRatePct: per100(expected),
        excessPer100: per100(observed - expected), ciPer100: per100(half),
        lossPer100: per100(loss), expectedLossPer100: per100(expectedLoss),
        counts: count >= CONTEXT_MIN_HANDS && Math.abs(observed - expected) > half,
      };
    }),
  }));
  const findings = factors.flatMap(factor => factor.buckets.filter(bucket => bucket.counts).map(bucket => ({
    factor: factor.id, factorTitle: factor.title, bucket: bucket.id, bucketLabel: bucket.label,
    n: bucket.n, excessPer100: bucket.excessPer100, ciPer100: bucket.ciPer100, worse: bucket.excessPer100 > 0,
  }))).sort((a, b) => Math.abs(b.excessPer100) / Math.max(b.ciPer100, 1e-9) - Math.abs(a.excessPer100) / Math.max(a.ciPer100, 1e-9));
  return { n, errors, minHands: CONTEXT_MIN_HANDS, factors, findings };
}
