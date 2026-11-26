import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeHandFast, parseHand, standardVariant } from "@perfect-draw/engine";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { db, initializeDatabase } from "../src/data/db";
import { machineService } from "../src/services/machines";
import { walletService } from "../src/services/wallets";
import { sessionService } from "../src/services/sessions";
import { createPlayService } from "../src/services/play";
import { ReviewsDoneError, trainingService } from "../src/services/training";

const table = getLibraryPayTable("jacks-or-better-9-6");
let clock = new Date("2026-12-01T09:00:00").getTime();
beforeEach(async () => {
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await db.transaction("rw", db.tables, async () => { for (const item of db.tables) await item.clear(); });
  await initializeDatabase();
});
afterEach(() => vi.restoreAllMocks());

/** A play service whose "worker" deals the given hand and records what each deal asked for. */
async function setup(hand = "Ah Kh Qh Jh 2c") {
  const cards = parseHand(hand);
  const api = {
    prepareRound: vi.fn(async (_id: string, coins: number) => ({
      analysis: analyzeHandFast(cards, standardVariant.valueVector(table, coins, {})),
      drawDecks: [Array.from({ length: 52 }, (_, i) => i).filter(card => !cards.includes(card))],
    })),
    resolveRound: vi.fn(),
  };
  const play = createPlayService(() => api as never);
  const wallet = await walletService.create({ name: "Practice", initialCents: 10_000 });
  const machine = await machineService.save({ name: "Jacks", paytableId: table.id, defaultWalletId: wallet.id, denominationCents: 25 });
  return { play, api, machine };
}
async function answer(play: ReturnType<typeof createPlayService>, sessionId: string, mask: number) {
  const dealt = await play.deal(sessionId, (await sessionService.list()).find(row => row.id === sessionId)!.state.handId);
  await sessionService.applyAction(sessionId, { type: "hold", heldMask: mask, handId: dealt.state.handId });
  return play.submit(sessionId, dealt.state.handId!);
}

describe("review cards from play", () => {
  it("every first decision updates its category's card; a mistake brings it back in 10 minutes", async () => {
    const { play, machine } = await setup();
    const drill = await sessionService.start({ machineId: machine.id, mode: "drill" });
    await answer(play, drill.id, 0b00000); // drawing five instead of holding the four to a royal: a mistake
    let [card] = await trainingService.cards();
    expect(card).toMatchObject({ familyId: "jacks_or_better", alpha: 1, beta: 2, reps: 1, dueAt: clock + 600_000 });
    expect(card.evLostTotal).toBeGreaterThan(0);
    clock += 60_000;
    await answer(play, drill.id, 0b01111); // right, but not due yet: counts only
    [card] = await trainingService.cards();
    expect([card.alpha, card.reps, card.dueAt]).toEqual([2, 1, clock - 60_000 + 600_000]);
  });
});

describe("today's review", () => {
  it("serves due cards to the daily cap, then stops until Keep going", async () => {
    const { play, api, machine } = await setup();
    const drill = await sessionService.start({ machineId: machine.id, mode: "drill" });
    await answer(play, drill.id, 0); // the card is due again in 10 minutes
    await sessionService.close(drill.id);
    await trainingService.setDailyCap(5);
    const review = await trainingService.start({ machineId: machine.id, kind: "review" });
    expect(review.training).toMatchObject({ kind: "review", keepGoing: false });
    await expect(play.deal(review.id, null)).rejects.toThrow(ReviewsDoneError); // nothing due yet
    clock += 11 * 60_000;
    const label = (await trainingService.cards())[0].label;
    await answer(play, review.id, 0b01111);
    expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { labels: [label] });
    // Make it due again after each answer until 5 reviews are done today: the cap.
    for (let count = 1; count < 5; count++) {
      const [card] = await trainingService.cards();
      await db.table("categoryMastery").put({ ...card, dueAt: clock - 1 });
      await answer(play, review.id, 0b01111);
    }
    const [card] = await trainingService.cards();
    await db.table("categoryMastery").put({ ...card, dueAt: clock - 1 });
    expect(await trainingService.queue("jacks_or_better")).toMatchObject({ done: 5, capReached: true, next: null });
    await expect(play.deal(review.id, (await sessionService.list()).find(row => row.id === review.id)!.state.handId)).rejects.toThrow("Keep going");
    await trainingService.keepGoing(review.id);
    await answer(play, review.id, 0b01111);
    expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { labels: [label] });
  });
});

describe("training plans", () => {
  it("close calls ask for hands within the slider's gap (credits per coin × the bet)", async () => {
    const { play, api, machine } = await setup();
    const session = await trainingService.start({ machineId: machine.id, kind: "close_calls", closeCallPerCoin: 0.25 });
    expect(session.training).toMatchObject({ kind: "close_calls", closeCallPerCoin: 0.25 });
    await play.deal(session.id, null);
    expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { closeCallMaxGap: 1.25 });
  });
  it("the Weakness Trainer mixes its targets, due cards and real hands", async () => {
    const { machine } = await setup();
    vi.spyOn(trainingService, "weaknessTargets").mockResolvedValue([{ bestLabel: "Two pair", chosenLabel: "One pair", weight: 1 }]);
    const session = await trainingService.start({ machineId: machine.id, kind: "weakness" });
    expect(session.training?.targets).toEqual([{ bestLabel: "Two pair", chosenLabel: "One pair", weight: 1 }]);
    expect(await trainingService.nextDeal(session, 5, () => 0.1)).toEqual({ labels: ["Two pair"], pairs: [{ correct: "Two pair", confusedWith: "One pair" }] });
    expect(await trainingService.nextDeal(session, 5, () => 0.95)).toEqual({ labels: undefined, pairs: undefined });
  });
  it("only run in Rapid Drill, and the daily cap stays in range", async () => {
    const { machine } = await setup();
    await expect(sessionService.start({ machineId: machine.id, mode: "free_play", training: { kind: "review", keepGoing: false } })).rejects.toThrow("Rapid Drill");
    await expect(trainingService.setDailyCap(1)).rejects.toThrow();
  });
});
