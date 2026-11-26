import { describe, expect, it } from "vitest";
import { applyAnswer, errorRate, fsrsSchedule, graduated, priority, retrievability, reviewQueue, weaknessPick } from "../src/training/core";
import type { Answer, Card } from "../src/training/core";

const DAY = 86_400_000;
const T0 = new Date("2026-12-01T09:00:00").getTime();
let ids = 0;
const newId = () => `card-${ids++}`;
const answer = (correct: boolean, at: number, over: Partial<Answer> = {}): Answer => ({ familyId: "jacks_or_better", label: "4 to a flush", correct, evLossPerCoin: 0.3, at, ...over });

describe("FSRS", () => {
  it("schedules a new card by its first answer, with a 90% recall interval equal to the stability", () => {
    const good = fsrsSchedule(null, 3, T0);
    expect(good.stability).toBeCloseTo(3.7145, 9);
    expect(good.dueAt).toBe(T0 + 4 * DAY);
    const again = fsrsSchedule(null, 1, T0);
    expect(again.dueAt).toBe(T0 + 10 * 60_000);
    expect(again.difficulty).toBeGreaterThan(good.difficulty);
    expect(retrievability(good.stability, good.stability)).toBeCloseTo(0.9, 9);
  });
  it("grows the interval after each on-time right answer and shrinks it after a lapse", () => {
    let state = { ...fsrsSchedule(null, 3, T0), lastReviewedAt: T0 };
    const intervals: number[] = [];
    for (let review = 0; review < 4; review++) {
      const at = state.dueAt;
      state = { ...fsrsSchedule(state, 3, at), lastReviewedAt: at };
      intervals.push(Math.round((state.dueAt - at) / DAY));
    }
    expect(intervals.every((interval, index) => index === 0 || interval > intervals[index - 1])).toBe(true);
    const lapse = fsrsSchedule(state, 1, state.dueAt);
    expect(lapse.stability).toBeLessThan(state.stability);
    expect(lapse.dueAt - state.dueAt).toBe(10 * 60_000);
  });
});

describe("cards", () => {
  it("count every answer; only due cards or mistakes change the schedule", () => {
    const card = applyAnswer(undefined, answer(true, T0), newId);
    expect([card.alpha, card.beta, card.reps, card.dueAt]).toEqual([2, 1, 1, T0 + 4 * DAY]);
    // Right again an hour later, before it's due: counts only.
    const early = applyAnswer(card, answer(true, T0 + 3_600_000), newId);
    expect([early.alpha, early.reps, early.dueAt]).toEqual([3, 1, card.dueAt]);
    // Wrong before it's due: a lapse, back in 10 minutes.
    const lapse = applyAnswer(early, answer(false, T0 + 7_200_000), newId);
    expect([lapse.beta, lapse.reps, lapse.lapses, lapse.dueAt]).toEqual([2, 2, 1, T0 + 7_200_000 + 600_000]);
    expect(lapse.evLostTotal).toBeCloseTo(0.3, 9);
    // Right when due: a scheduled review.
    const review = applyAnswer(lapse, answer(true, lapse.dueAt), newId);
    expect(review.reps).toBe(3);
    expect(review.dueAt).toBeGreaterThan(lapse.dueAt + DAY - 1);
  });
  it("rank by cost (mistake rate × EV lost per mistake) and graduate at under 2% mistakes over 30+ hands", () => {
    const cheap = { alpha: 9, beta: 3, evLostTotal: 0.1 } as Card;
    const costly = { alpha: 9, beta: 3, evLostTotal: 2 } as Card;
    expect(priority(costly)).toBeGreaterThan(priority(cheap));
    expect(priority({ alpha: 20, beta: 1, evLostTotal: 0 } as Card)).toBe(0);
    expect(errorRate({ alpha: 1, beta: 1 })).toBe(0.5);
    expect(graduated({ alpha: 50, beta: 1 } as Card)).toBe(true); // 49 right: 1/51 ≈ 1.96%
    expect(graduated({ alpha: 30, beta: 1 } as Card)).toBe(false); // 29 hands
    expect(graduated({ alpha: 60, beta: 3 } as Card)).toBe(false); // 2 mistakes in 61: 4.8%
  });
});

describe("today's review", () => {
  const card = (label: string, dueAt: number, over: Partial<Card> = {}): Card => ({
    id: label, updatedAt: 0, deletedAt: null, familyId: "jacks_or_better", label, alpha: 5, beta: 2, lastSeenAt: 0,
    fsrsStability: 3, fsrsDifficulty: 5, dueAt, evLostTotal: 0.1, reps: 1, lapses: 0, lastReviewedAt: T0 - 5 * DAY, ...over,
  });
  it("serves due cards most costly first, for one game, up to the daily cap, then only with Keep going", () => {
    const cards = [
      card("cheap", T0 - DAY), card("costly", T0 - 1000, { evLostTotal: 3 }), card("later today", T0 + 3_600_000),
      card("tomorrow", T0 + DAY), card("other game", T0 - DAY, { familyId: "deuces_wild" }),
    ];
    const queue = reviewQueue(cards, "jacks_or_better", T0, 50, 2, false);
    expect(queue.due.map(item => item.label)).toEqual(["costly", "cheap"]);
    expect([queue.next?.label, queue.done, queue.leftToday, queue.dueToday, queue.capReached]).toEqual(["costly", 2, 2, 3, false]);
    const capped = reviewQueue(cards, "jacks_or_better", T0, 2, 2, false);
    expect([capped.next, capped.capReached, capped.leftToday]).toEqual([null, true, 0]);
    expect(reviewQueue(cards, "jacks_or_better", T0, 2, 2, true).next?.label).toBe("costly");
    expect(reviewQueue(cards, "jacks_or_better", T0, 5, 4, false).leftToday).toBe(1);
  });
  it("leaves out cards the table can't deal and cards hidden by an open quiet session", () => {
    const cards = [card("here", T0 - DAY), card("other table", T0 - DAY, { evLostTotal: 3 }), card("quiet", T0 - DAY, { evLostTotal: 2 })];
    const scope = { available: new Set(["here", "quiet"]), hidden: new Set(["quiet"]) };
    const queue = reviewQueue(cards, "jacks_or_better", T0, 50, 0, false, scope);
    expect([queue.due.map(item => item.label), queue.next?.label, queue.leftToday, queue.dueToday]).toEqual([["here"], "here", 1, 1]);
    expect(reviewQueue(cards, "jacks_or_better", T0, 50, 0, false).due).toHaveLength(3);
  });
});

describe("Weakness Trainer mix", () => {
  const targets = [{ bestLabel: "A", chosenLabel: "a", weight: 3 }, { bestLabel: "B", chosenLabel: "b", weight: 1 }];
  const due = { label: "R" } as Card;
  it("is 70% weakness pairs by weight, 20% due reviews, 10% any hand", () => {
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const counts: Record<string, number> = {};
    for (let index = 0; index < 20_000; index++) {
      const pick = weaknessPick(targets, due, random);
      const key = pick.reason === "weakness" ? pick.labels![0] : pick.reason;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(counts.A / 20_000).toBeCloseTo(0.525, 1);
    expect(counts.B / 20_000).toBeCloseTo(0.175, 1);
    expect(counts.review / 20_000).toBeCloseTo(0.2, 1);
    expect(counts.random / 20_000).toBeCloseTo(0.1, 1);
    expect(weaknessPick(targets, due, () => 0.1)).toMatchObject({ pairs: [{ correct: "A", confusedWith: "a" }] });
  });
  it("falls back to reviews and real hands when there's nothing to target", () => {
    expect(weaknessPick([], due, () => 0.5).reason).toBe("review");
    expect(weaknessPick([], null, () => 0.5).reason).toBe("random");
    expect(weaknessPick(targets, null, () => 0.8).reason).toBe("random");
  });
});
