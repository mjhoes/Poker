import Dexie from "dexie";
import { masterySchema, newId, profileSchema, sessionSchema, uuid } from "@perfect-draw/shared";
import type { GameFamilyId } from "@perfect-draw/engine";
import type { Session } from "@perfect-draw/shared";
import { getLibraryPayTable, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { db, live, requireRecord } from "../data/db";
import { applyAnswer, graduated, reviewQueue, startOfDay, weaknessPick } from "../training/core";
import type { Answer, Card, Target } from "../training/core";
import type { DealTarget } from "../worker/engine-api";
import { sessionService } from "./sessions";
import { statsService } from "./statistics";

/*
 * Adaptive training (docs/15-ADAPTIVE-TRAINING-PLAN.md): review cards, today's review, and the plans that pick each
 * Rapid Drill hand. The arithmetic lives in training/core.ts.
 */

export class ReviewsDoneError extends Error {
  constructor(capReached: boolean) {
    super(capReached ? "That's today's reviews. Keep going for the rest that are due, or come back tomorrow." : "Nothing else is due for review on this game right now.");
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
  /** Today's review for a game. */
  async queue(familyId: string, keepGoing = false, now = Date.now()) {
    return reviewQueue(await allCards(), familyId, now, await dailyCap(), await reviewsToday(now), keepGoing);
  },
  /**
   * The Weakness Trainer's targets on a table: Statistics' costliest confusion pairs (recency-weighted EV lost),
   * leaving out categories whose cards have graduated; at most five.
   */
  async weaknessTargets(paytableId: string, coins: number): Promise<Target[]> {
    const familyId = await familyOf(paytableId);
    const report = await statsService.report({ paytableId, coins: coins as 1 | 2 | 3 | 4 | 5, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const cards = new Map((await allCards()).filter(card => card.familyId === familyId).map(card => [card.label, card]));
    return report.confusion
      .filter(pair => pair.weightedEvLost > 0 && !(cards.get(pair.bestLabel) && graduated(cards.get(pair.bestLabel)!)))
      .sort((a, b) => b.weightedEvLost - a.weightedEvLost).slice(0, 5)
      .map(pair => ({ bestLabel: pair.bestLabel, chosenLabel: pair.chosenLabel, weight: pair.weightedEvLost }));
  },
  /** Starts a training session (Rapid Drill) on a machine. */
  async start(input: { machineId: string; kind: "review" | "weakness" | "close_calls"; closeCallPerCoin?: number; keepGoing?: boolean }) {
    uuid.parse(input.machineId);
    const machine = await requireRecord("machines", input.machineId);
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
    const queue = await trainingService.queue(await familyOf(session.machineSnapshot.paytableId), training.kind === "review" && training.keepGoing);
    if (training.kind === "review") {
      if (!queue.next) throw new ReviewsDoneError(queue.capReached);
      return { labels: [queue.next.label] };
    }
    const pick = weaknessPick(training.targets ?? [], queue.next, random);
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
