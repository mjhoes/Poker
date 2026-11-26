import type { Records } from "@perfect-draw/shared";

/*
 * Adaptive training's arithmetic (docs/15-ADAPTIVE-TRAINING-PLAN.md), pure and unit-tested: FSRS spaced repetition,
 * each card's mastery, the order of today's review, and the Weakness Trainer's mix.
 */

export type Card = Records["categoryMastery"];
const DAY_MS = 86_400_000;
export const RELEARN_MS = 10 * 60_000;

/* ---------- FSRS v4.5 (default weights, 90% target recall) ---------- */
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755] as const;
const DECAY = -0.5, FACTOR = 19 / 81;
/** 1 = Again (wrong), 3 = Good (right). Hard and Easy aren't used: a hold is right or it isn't. */
export type Grade = 1 | 3;
const clampD = (d: number) => Math.min(10, Math.max(1, d));
export const retrievability = (elapsedDays: number, stability: number) => (1 + FACTOR * Math.max(0, elapsedDays) / stability) ** DECAY;
const initialDifficulty = (grade: Grade) => clampD(W[4] - (grade - 3) * W[5]);
export function fsrsSchedule(previous: { stability: number; difficulty: number; lastReviewedAt: number } | null, grade: Grade, at: number) {
  let stability: number, difficulty: number;
  if (!previous) {
    stability = W[grade - 1];
    difficulty = initialDifficulty(grade);
  } else {
    const r = retrievability((at - previous.lastReviewedAt) / DAY_MS, previous.stability);
    const d = previous.difficulty;
    stability = grade === 1
      ? Math.min(previous.stability, W[11] * d ** -W[12] * ((previous.stability + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)))
      : previous.stability * (1 + Math.exp(W[8]) * (11 - d) * previous.stability ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1));
    difficulty = clampD(W[7] * initialDifficulty(3) + (1 - W[7]) * (d - W[6] * (grade - 3)));
  }
  // At 90% target recall the interval equals the stability (in days); a wrong answer comes back in 10 minutes.
  const dueAt = grade === 1 ? at + RELEARN_MS : at + Math.max(1, Math.round(stability)) * DAY_MS;
  return { stability, difficulty, dueAt };
}

/* ---------- Cards ---------- */
export type Answer = { familyId: string; label: string; correct: boolean; /** EV lost per coin bet. */ evLossPerCoin: number; at: number };
export const mistakes = (card: Pick<Card, "beta">) => card.beta - 1;
export const handsSeen = (card: Pick<Card, "alpha" | "beta">) => card.alpha + card.beta - 2;
/** Beta(1,1) posterior mean of the mistake rate. */
export const errorRate = (card: Pick<Card, "alpha" | "beta">) => card.beta / (card.alpha + card.beta);
/** What the card costs per hand dealt in it: mistake rate × average EV lost per mistake (per coin). */
export const priority = (card: Pick<Card, "alpha" | "beta" | "evLostTotal">) => mistakes(card) > 0 ? errorRate(card) * card.evLostTotal / mistakes(card) : 0;
/** Mastered: mistakes under 2% (posterior) over 30+ hands. Such categories leave the Weakness Trainer's focus. */
export const graduated = (card: Pick<Card, "alpha" | "beta">) => handsSeen(card) >= 30 && errorRate(card) < 0.02;

/**
 * A first decision updates its category's card. Counts always change. The schedule changes when the card is new or due
 * (a scheduled review), or when the answer is wrong (a lapse: back in 10 minutes); a right answer before the card is
 * due leaves the schedule alone.
 */
export function applyAnswer(card: Card | undefined, answer: Answer, newId: () => string): Card {
  const grade: Grade = answer.correct ? 3 : 1;
  if (!card) {
    const schedule = fsrsSchedule(null, grade, answer.at);
    return {
      id: newId(), updatedAt: answer.at, deletedAt: null, familyId: answer.familyId as Card["familyId"], label: answer.label,
      alpha: 1 + (answer.correct ? 1 : 0), beta: 1 + (answer.correct ? 0 : 1), lastSeenAt: answer.at,
      fsrsStability: schedule.stability, fsrsDifficulty: schedule.difficulty, dueAt: schedule.dueAt,
      evLostTotal: answer.correct ? 0 : answer.evLossPerCoin, reps: 1, lapses: 0, lastReviewedAt: answer.at,
    };
  }
  const counts = {
    alpha: card.alpha + (answer.correct ? 1 : 0), beta: card.beta + (answer.correct ? 0 : 1),
    evLostTotal: card.evLostTotal + (answer.correct ? 0 : answer.evLossPerCoin), lastSeenAt: answer.at, updatedAt: answer.at,
  };
  if (card.dueAt > answer.at && answer.correct) return { ...card, ...counts };
  const schedule = fsrsSchedule(card.lastReviewedAt === null ? null
    : { stability: card.fsrsStability, difficulty: card.fsrsDifficulty, lastReviewedAt: card.lastReviewedAt }, grade, answer.at);
  return {
    ...card, ...counts, fsrsStability: schedule.stability, fsrsDifficulty: schedule.difficulty, dueAt: schedule.dueAt,
    reps: card.reps + 1, lapses: card.lapses + (answer.correct ? 0 : 1), lastReviewedAt: answer.at,
  };
}

/* ---------- Today's review ---------- */
export const startOfDay = (at: number) => { const date = new Date(at); date.setHours(0, 0, 0, 0); return date.getTime(); };
/**
 * Which of a game's cards a table can review. `available`: the categories that are a best hold on the table at its bet
 * (a family-wide card for any other can't be dealt there). `hidden`: categories holding answers from an open session
 * with quiet feedback, kept out of sight (and out of review) until it closes.
 */
export type ReviewScope = { available?: ReadonlySet<string>; hidden?: ReadonlySet<string> };
export const reviewable = (card: Card, scope: ReviewScope) =>
  (!scope.available || scope.available.has(card.label)) && !scope.hidden?.has(card.label);
/**
 * Today's review for one game on one table: cards due now, most costly first (then the longest overdue). `done` =
 * reviews answered today (all games); within the cap it offers the first, past it only with Keep going. `dueToday` also
 * counts cards coming due later today.
 */
export function reviewQueue(cards: readonly Card[], familyId: string, now: number, cap: number, done: number, keepGoing: boolean, scope: ReviewScope = {}) {
  const mine = cards.filter(card => card.familyId === familyId && card.deletedAt == null && reviewable(card, scope));
  const due = mine.filter(card => card.dueAt <= now).sort((a, b) => priority(b) - priority(a) || a.dueAt - b.dueAt || a.label.localeCompare(b.label));
  const capReached = done >= cap;
  const endOfDay = startOfDay(now) + DAY_MS;
  return {
    due, done, cap, capReached,
    next: due.length && (keepGoing || !capReached) ? due[0] : null,
    /** Due now and still within today's cap. */
    leftToday: Math.min(due.length, Math.max(0, cap - done)),
    dueToday: mine.filter(card => card.dueAt < endOfDay).length,
  };
}

/* ---------- What each deal trains ---------- */
export type Target = { bestLabel: string; chosenLabel: string; weight: number };
/** What the next hand should be: a category (and optionally the hold it's confused with), a close call, or any hand. */
export type DealPick = { labels?: string[]; pairs?: { correct: string; confusedWith: string }[]; closeCallMaxGap?: number; reason: "weakness" | "review" | "random" | "close_call" };
/** The Weakness Trainer's mix (Tech Spec §6): 70% a weakness pair (by weight), 20% a due review card, 10% any real hand. */
export function weaknessPick(targets: readonly Target[], due: Card | null, random: () => number): DealPick {
  const roll = random();
  const total = targets.reduce((sum, target) => sum + target.weight, 0);
  if (roll < 0.7 && targets.length && total > 0) {
    let point = random() * total;
    const target = targets.find(item => (point -= item.weight) < 0) ?? targets[targets.length - 1];
    return { labels: [target.bestLabel], pairs: [{ correct: target.bestLabel, confusedWith: target.chosenLabel }], reason: "weakness" };
  }
  if (roll < 0.9 && due) return { labels: [due.label], reason: "review" };
  return { reason: "random" };
}
