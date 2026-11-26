import Dexie from "dexie";
import { masterySchema, newId, profileSchema, sessionSchema, uuid } from "@perfect-draw/shared";
import type { GameFamilyId } from "@perfect-draw/engine";
import type { Session } from "@perfect-draw/shared";
import { getLibraryPayTable, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { db, live, requireRecord } from "../data/db";
import { applyAnswer, graduated, reviewQueue, startOfDay, weaknessPick } from "../training/core";
import type { Answer, Card, Target } from "../training/core";
import { engineClient } from "../worker/client";
import type { DealTarget, LadderTier } from "../worker/engine-api";
import { ladderPick, switcherNext } from "../training/plans";
import { sessionService } from "./sessions";
import { statsService } from "./statistics";

/*
 * Adaptive training (docs/15-ADAPTIVE-TRAINING-PLAN.md): review cards, today's review, and the plans that pick each
 * Rapid Drill hand. The arithmetic lives in training/core.ts.
 */

export class ReviewsDoneError extends Error {
  constructor(capReached: boolean) {
    super(capReached ? "That's today's reviews. Keep going for the rest that are due, or come back tomorrow." : "Nothing else is due for review on this table right now.");
  }
}

async function familyOf(paytableId: string): Promise<GameFamilyId> {
  const library = PAY_TABLE_LIBRARY.find(table => table.id === paytableId);
  if (library) return library.familyId;
  const row = await db.records("paytables").get(paytableId);
  if (!row) return getLibraryPayTable(paytableId).familyId;
  return row.familyId as GameFamilyId;
}
async function dailyCap() { return profileSchema.parse(await db.records("profile").get("local")).prefs.dailyReviewCap; }
const allCards = async () => (await db.records("categoryMastery").toArray()).filter(live).map(row => masterySchema.parse(row));
/**
 * Reviews answered today, any game: first decisions in review sessions since local midnight. Only these count toward
 * the daily cap, so ordinary play and the trainers never use it up.
 */
async function reviewsToday(now: number) {
  const reviewSessions = (await db.records("sessions").toArray()).filter(session => live(session) && session.training?.kind === "review").map(session => session.id);
  if (!reviewSessions.length) return 0;
  return db.records("decisions").where("sessionId").anyOf(reviewSessions)
    .filter(row => live(row) && !row.isCorrection && row.createdAt >= startOfDay(now)).count();
}
/**
 * A game's categories answered in sessions still open with quiet feedback (Rapid Drill always shows its grades, so it is
 * never quiet). Their cards and mistakes already hold those answers, so they stay out of sight on Train (the cards, the
 * review, the Weakness Trainer's targets) until the session closes and its report shows the results.
 */
async function quietLabels(familyId: string) {
  const open = (await db.records("sessions").toArray()).filter(session => live(session) && session.status !== "closed" &&
    session.mode !== "drill" && session.state.feedbackMode === "silent_report");
  const ids: string[] = [];
  for (const session of open) if (await familyOf(session.machineSnapshot.paytableId) === familyId) ids.push(session.id);
  if (!ids.length) return new Set<string>();
  const rows = await db.records("decisions").where("sessionId").anyOf(ids).filter(live).toArray();
  return new Set(rows.map(row => row.bestLabel));
}
/** A table at a bet, for review: its game and the categories it can deal. */
export type TrainingTable = { familyId: string; available: ReadonlySet<string> };

/** Call inside the decision's transaction (it must include categoryMastery): a first decision updates its card. */
export async function recordAnswer(answer: Answer) {
  const transaction = Dexie.currentTransaction;
  if (transaction?.mode !== "readwrite" || !transaction.storeNames.includes("categoryMastery")) throw new Error("Card updates must share the decision's transaction.");
  const existing = await db.records("categoryMastery").where("[familyId+label]").equals([answer.familyId, answer.label]).first();
  const card = existing && live(existing) ? masterySchema.parse(existing) : undefined;
  await db.records("categoryMastery").put(masterySchema.parse(applyAnswer(card, answer, newId)));
}

export const trainingService = {
  cards: allCards,
  familyOf,
  /** The categories that are a best hold on a table at a bet: the only cards it can review. */
  labelsOn: (paytableId: string, coins: number) => engineClient().trainableLabels(paytableId, coins),
  async table(paytableId: string, coins: number): Promise<TrainingTable> {
    return { familyId: await familyOf(paytableId), available: new Set(await trainingService.labelsOn(paytableId, coins)) };
  },
  /**
   * Today's review on a table: its game's due cards that it can deal, leaving out cards hidden by an open quiet
   * session (`hidden`).
   */
  async queue(table: TrainingTable, keepGoing = false, now = Date.now()) {
    const hidden = await quietLabels(table.familyId);
    const queue = reviewQueue(await allCards(), table.familyId, now, await dailyCap(), await reviewsToday(now), keepGoing, { available: table.available, hidden });
    return { ...queue, hidden };
  },
  /**
   * The Weakness Trainer's targets on a table: Statistics' costliest confusion pairs (recency-weighted EV lost),
   * leaving out categories whose cards have graduated, and categories answered in an open quiet session (any pair or
   * graduation change there could show its results); at most five.
   */
  async weaknessTargets(paytableId: string, coins: number): Promise<Target[]> {
    const familyId = await familyOf(paytableId);
    const report = await statsService.report({ paytableId, coins: coins as 1 | 2 | 3 | 4 | 5, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const cards = new Map((await allCards()).filter(card => card.familyId === familyId).map(card => [card.label, card]));
    const hidden = await quietLabels(familyId);
    return report.confusion
      .filter(pair => pair.weightedEvLost > 0 && !hidden.has(pair.bestLabel) && !(cards.get(pair.bestLabel) && graduated(cards.get(pair.bestLabel)!)))
      .sort((a, b) => b.weightedEvLost - a.weightedEvLost).slice(0, 5)
      .map(pair => ({ bestLabel: pair.bestLabel, chosenLabel: pair.chosenLabel, weight: pair.weightedEvLost }));
  },
  /** A table's chart for the Strategy Ladder (built the first time for a custom table). */
  ladderChart: (paytableId: string, tier: LadderTier) => engineClient().ladderChart(paytableId, tier),
  /** How often the best hold differs between a table and each other table, at a bet (for the Pay Table Switcher). */
  switcherDiffer: (paytableId: string, others: string[], coins: number) => engineClient().switcherDiffer(paytableId, others, coins),
  /** Strategy Ladder progress on a pay table's chart: the latest ladder session's, or null before the first. */
  async ladderProgress(paytableId: string, tier: LadderTier) {
    const sessions = (await db.records("sessions").toArray()).filter(session => live(session) &&
      session.training?.kind === "ladder" && session.training.ladder?.tier === tier && session.machineSnapshot.paytableId === paytableId);
    const latest = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return latest ? { ...latest.training!.ladder!, sessionId: latest.id, open: latest.status !== "closed" } : null;
  },
  /** Starts a training session (Rapid Drill) on a machine. */
  async start(input: { machineId: string; kind: "review" | "weakness" | "close_calls"; closeCallPerCoin?: number; keepGoing?: boolean }
    | { machineId: string; kind: "ladder"; tier: LadderTier; restart?: boolean }
    | { machineId: string; kind: "switcher"; compareWith: string[] }) {
    uuid.parse(input.machineId);
    const machine = await requireRecord("machines", input.machineId);
    if (input.kind === "ladder") {
      const chart = await trainingService.ladderChart(machine.paytableId, input.tier);
      const lines = chart.lines.flatMap((line, index) => line.dealable ? [index] : []);
      if (!lines.length) throw new Error("No line of this chart can be practiced on this table.");
      // Carry on from the latest ladder on this chart, unless it was rebuilt differently or you start over.
      const previous = input.restart ? null : await trainingService.ladderProgress(machine.paytableId, input.tier);
      const resume = previous && previous.lines.join(",") === lines.join(",") ? previous : null;
      return sessionService.start({
        machineId: machine.id, mode: "drill",
        training: { kind: "ladder", keepGoing: false, ladder: { tier: input.tier, lines, step: resume?.step ?? 1, streak: resume?.streak ?? 0, pending: null } },
      });
    }
    if (input.kind === "switcher") {
      const others = [...new Set(input.compareWith)];
      if (!others.length || others.length > 2) throw new Error("Choose one or two other pay tables.");
      if (others.includes(machine.paytableId)) throw new Error("Choose pay tables other than this machine's.");
      const familyId = await familyOf(machine.paytableId);
      for (const other of others) if (await familyOf(other) !== familyId) throw new Error("The Pay Table Switcher compares tables of the same game.");
      return sessionService.start({
        machineId: machine.id, mode: "drill",
        training: { kind: "switcher", keepGoing: false, switcher: { tables: [machine.paytableId, ...others], round: null } },
      });
    }
    const targets = input.kind === "weakness" ? await trainingService.weaknessTargets(machine.paytableId, machine.coins) : undefined;
    return sessionService.start({
      machineId: machine.id, mode: "drill",
      training: { kind: input.kind, keepGoing: input.keepGoing ?? false, targets, closeCallPerCoin: input.kind === "close_calls" ? input.closeCallPerCoin ?? 0.1 : undefined },
    });
  },
  /** What the next hand in a training session should be. A review session with nothing left throws ReviewsDoneError. */
  async nextDeal(session: Session, coins: number, random: () => number = Math.random): Promise<DealTarget> {
    const training = session.training!;
    if (training.kind === "close_calls") return { closeCallMaxGap: (training.closeCallPerCoin ?? 0.1) * coins };
    if (training.kind === "ladder") return { ladder: { tier: training.ladder!.tier, line: ladderPick(training.ladder!, random).line } };
    if (training.kind === "switcher") return switcherNext(training.switcher!, random);
    const table = await trainingService.table(session.machineSnapshot.paytableId, coins);
    if (training.kind === "review") {
      const queue = await trainingService.queue(table, training.keepGoing);
      if (!queue.next) throw new ReviewsDoneError(queue.capReached);
      // Strict: the card's own category or nothing, so an answer always reviews the card that was due.
      return { labels: [queue.next.label], strict: true };
    }
    // The daily cap governs Today's Review only: the Weakness Trainer's share of due cards goes on past it.
    const pick = weaknessPick(training.targets ?? [], (await trainingService.queue(table, true)).next, random);
    return { labels: pick.labels, pairs: pick.pairs };
  },
  /** Lets a review session go past the daily cap. */
  async keepGoing(sessionId: string) {
    uuid.parse(sessionId);
    return db.transaction("rw", db.records("sessions"), async () => {
      const session = await requireRecord("sessions", sessionId);
      if (session.training?.kind !== "review") throw new Error("Only a review session has a daily cap.");
      const next = sessionSchema.parse({ ...session, updatedAt: Date.now(), training: { ...session.training, keepGoing: true } });
      await db.records("sessions").put(next);
      return next;
    });
  },
  async setDailyCap(cap: number) {
    await db.transaction("rw", db.records("profile"), async () => {
      const profile = profileSchema.parse(await db.records("profile").get("local"));
      await db.records("profile").put(profileSchema.parse({ ...profile, updatedAt: Date.now(), prefs: { ...profile.prefs, dailyReviewCap: cap } }));
    });
  },
};
export type { Card };
