import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeHandFast, parseHand, resolveRound, standardVariant } from "@perfect-draw/engine";
import type { Hand } from "@perfect-draw/engine";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { newId } from "@perfect-draw/shared";
import { db, initializeDatabase } from "../src/data/db";
import { machineService } from "../src/services/machines";
import { walletService } from "../src/services/wallets";
import { sessionService } from "../src/services/sessions";
import { createPlayService } from "../src/services/play";
import { ReviewsDoneError, trainingService } from "../src/services/training";
import { statsService } from "../src/services/statistics";
import { paytableService } from "../src/services/paytables";
import { draftFromLibrary, quickFill } from "../src/paytables/model";

const table = getLibraryPayTable("jacks-or-better-9-6");
let clock = new Date("2026-12-01T09:00:00").getTime();
/** The categories the (fake) engine says a table can deal: every card's by default. */
let onTable: string[] | null = null;
beforeEach(async () => {
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  onTable = null;
  vi.spyOn(trainingService, "labelsOn").mockImplementation(async () => onTable ?? (await trainingService.cards()).map(card => card.label));
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
    expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { labels: [label], strict: true });
    // Make it due again after each answer until 5 reviews are done today: the cap.
    for (let count = 1; count < 5; count++) {
      const [card] = await trainingService.cards();
      await db.table("categoryMastery").put({ ...card, dueAt: clock - 1 });
      await answer(play, review.id, 0b01111);
    }
    const [card] = await trainingService.cards();
    await db.table("categoryMastery").put({ ...card, dueAt: clock - 1 });
    expect(await trainingService.queue(await trainingService.table(table.id, 5))).toMatchObject({ done: 5, capReached: true, next: null });
    // The cap is Today's Review's alone: the Weakness Trainer still gives due cards their 20% share.
    vi.spyOn(trainingService, "weaknessTargets").mockResolvedValue([{ bestLabel: "Two pair", chosenLabel: "One pair", weight: 1 }]);
    const weakness = await trainingService.start({ machineId: machine.id, kind: "weakness" });
    expect(await trainingService.nextDeal(weakness, 5, () => 0.8)).toEqual({ labels: [label], pairs: undefined });
    await expect(play.deal(review.id, (await sessionService.list()).find(row => row.id === review.id)!.state.handId)).rejects.toThrow("Keep going");
    await trainingService.keepGoing(review.id);
    await answer(play, review.id, 0b01111);
    expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { labels: [label], strict: true });
  });
  it("only reviews cards the table can deal: a family-wide card from another pay table is never served there", async () => {
    const { play, api } = await setup();
    const nsud = getLibraryPayTable("deuces-wild-nsud"), fullPay = getLibraryPayTable("deuces-wild-full-pay");
    const wallet = await walletService.create({ name: "Deuces", initialCents: 10_000 });
    const onNsud = await machineService.save({ name: "NSUD", paytableId: nsud.id, defaultWalletId: wallet.id, denominationCents: 25 });
    const onFullPay = await machineService.save({ name: "Full Pay", paytableId: fullPay.id, defaultWalletId: wallet.id, denominationCents: 25 });
    // An overdue card for a category that is a best hold on NSUD but never on Full-Pay Deuces Wild (see training-tables.test).
    await db.table("categoryMastery").put({
      id: newId(), updatedAt: clock, deletedAt: null, familyId: "deuces_wild", label: "D0_2P", alpha: 1, beta: 2, lastSeenAt: clock - 86_400_000,
      fsrsStability: 0.5, fsrsDifficulty: 6, dueAt: clock - 3_600_000, evLostTotal: 0.4, reps: 1, lapses: 1, lastReviewedAt: clock - 86_400_000,
    });
    vi.mocked(trainingService.labelsOn).mockImplementation(async id => id === nsud.id ? ["D0_2P", "D0_HP"] : ["D0_HP"]);
    const there = await trainingService.start({ machineId: onNsud.id, kind: "review" });
    expect(await trainingService.nextDeal(there, 5)).toEqual({ labels: ["D0_2P"], strict: true });
    const here = await trainingService.start({ machineId: onFullPay.id, kind: "review" });
    expect(await trainingService.queue(await trainingService.table(fullPay.id, 5))).toMatchObject({ due: [], next: null, leftToday: 0, done: 0 });
    // Nothing is dealt, so no unrelated hand can use up the cap or leave the review due forever.
    await expect(play.deal(here.id, null)).rejects.toThrow(ReviewsDoneError);
    expect(api.prepareRound).not.toHaveBeenCalled();
  });
});

describe("quiet feedback", () => {
  it("keeps an open quiet session's answers off Train: its cards, review and weakness targets, even for an existing card", async () => {
    const { play, api, machine } = await setup();
    api.resolveRound.mockImplementation(async (hand: Hand, mask: number, decks: number[][], _id: string, coins: number) =>
      resolveRound(hand, mask, decks, table.familyId, standardVariant.valueVector(table, coins, {})));
    // An existing card: answered right in Rapid Drill (always graded, never quiet).
    const drill = await sessionService.start({ machineId: machine.id, mode: "drill", feedbackMode: "silent_report" });
    await answer(play, drill.id, 0b01111);
    const [card] = await trainingService.cards();
    const scope = () => trainingService.table(table.id, 5);
    expect((await trainingService.queue(await scope())).hidden.size).toBe(0);
    // The same category held wrong in a quiet Free Play session that stays open.
    const quiet = await sessionService.start({ machineId: machine.id, mode: "free_play", feedbackMode: "silent_report" });
    await answer(play, quiet.id, 0);
    clock += 11 * 60_000; // the lapse is due again: review must not show it either
    vi.spyOn(statsService, "report").mockResolvedValue({ confusion: [{ bestLabel: card.label, chosenLabel: "DRAW5", weightedEvLost: 1 }] } as never);
    expect([...(await trainingService.queue(await scope())).hidden]).toEqual([card.label]);
    expect((await trainingService.queue(await scope())).due).toEqual([]);
    expect(await trainingService.weaknessTargets(table.id, 5)).toEqual([]);
    await sessionService.close(quiet.id);
    expect((await trainingService.queue(await scope())).due.map(item => item.label)).toEqual([card.label]);
    expect(await trainingService.weaknessTargets(table.id, 5)).toEqual([{ bestLabel: card.label, chosenLabel: "DRAW5", weight: 1 }]);
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

describe("round B", () => {
  it("the Strategy Ladder deals its lines at 5 coins, climbs on first answers, and carries on in the next session", async () => {
    const { play, api } = await setup();
    const wallet = await walletService.create({ name: "Ladder", initialCents: 10_000 });
    const machine = await machineService.save({ name: "One coin", paytableId: table.id, coins: 1, defaultWalletId: wallet.id, denominationCents: 25 });
    vi.spyOn(trainingService, "ladderChart").mockResolvedValue({
      familyId: "jacks_or_better", tier: "Expert", returnPct: 99.5, optimalReturnPct: 99.54,
      lines: [{ label: "RF4", freq: 0.01, dealable: true }, { label: "rare", freq: 0, dealable: false }, { label: "2P", freq: 0.02, dealable: true }],
    });
    const ladder = await trainingService.start({ machineId: machine.id, kind: "ladder", tier: "Expert" });
    expect(ladder.training?.ladder).toEqual({ tier: "Expert", lines: [0, 2], step: 1, streak: 0, pending: null, progressAt: clock });
    // Max bet whatever the machine's default; the table can't change it.
    await expect(sessionService.applyAction(ladder.id, { type: "bet", coins: 2 })).rejects.toThrow("5 coins");
    for (let hand = 0; hand < 4; hand++) {
      await answer(play, ladder.id, 0b01111);
      expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { ladder: { tier: "Expert", line: 0 } });
    }
    let session = (await sessionService.list()).find(row => row.id === ladder.id)!;
    expect(session.training?.ladder).toMatchObject({ step: 2, streak: 0, pending: null });
    // A wrong answer on the newest line resets its run.
    vi.spyOn(Math, "random").mockReturnValue(0.1); // newest line
    await answer(play, ladder.id, 0);
    session = (await sessionService.list()).find(row => row.id === ladder.id)!;
    expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { ladder: { tier: "Expert", line: 2 } });
    expect(session.training?.ladder).toMatchObject({ step: 2, streak: 0 });
    await answer(play, ladder.id, 0b01111);
    await sessionService.close(ladder.id);
    // The next ladder on this chart carries on; starting over goes back to line 1; another chart starts fresh.
    clock += 1000;
    const resumed = await trainingService.start({ machineId: machine.id, kind: "ladder", tier: "Expert" });
    expect(resumed.training?.ladder).toMatchObject({ step: 2, streak: 1 });
    clock += 1000;
    expect((await trainingService.start({ machineId: machine.id, kind: "ladder", tier: "Expert", restart: true })).training?.ladder).toMatchObject({ step: 1, streak: 0 });
    // Closing the older ladder afterwards changes only its session, not which progress is newest (PR #10 review).
    clock += 1000;
    await sessionService.close(resumed.id);
    expect(await trainingService.ladderProgress(table.id, "Expert")).toMatchObject({ step: 1, streak: 0 });
    expect((await trainingService.start({ machineId: machine.id, kind: "ladder", tier: "Expert" })).training?.ladder).toMatchObject({ step: 1 });
    expect((await trainingService.start({ machineId: machine.id, kind: "ladder", tier: "Beginner" })).training?.ladder).toMatchObject({ tier: "Beginner", step: 1 });
  });
  it("the Pay Table Switcher deals one hand on each table in turn, and records each answer on its own table", async () => {
    const { play, api, machine } = await setup();
    const other = getLibraryPayTable("jacks-or-better-8-5");
    await expect(trainingService.start({ machineId: machine.id, kind: "switcher", compareWith: [getLibraryPayTable("deuces-wild-nsud").id] })).rejects.toThrow("same game");
    await expect(trainingService.start({ machineId: machine.id, kind: "switcher", compareWith: [] })).rejects.toThrow("one or two");
    const session = await trainingService.start({ machineId: machine.id, kind: "switcher", compareWith: [other.id] });
    expect(session.training?.switcher).toEqual({ tables: [table.id, other.id], round: null });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await answer(play, session.id, 0b01111);
    expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { paytableId: table.id, switcher: { others: [other.id], differ: true } });
    let state = (await sessionService.list()).find(row => row.id === session.id)!;
    expect(state.state.handPaytableId).toBeNull();
    const hand = state.state.analysis!.hand;
    expect(state.training?.switcher?.round).toEqual({ hand, next: 1 });
    await answer(play, session.id, 0b01111);
    expect(api.prepareRound).toHaveBeenLastCalledWith(other.id, 5, 1, null, { paytableId: other.id, hand });
    state = (await sessionService.list()).find(row => row.id === session.id)!;
    expect(state.state.handPaytableId).toBe(other.id);
    expect(state.training?.switcher?.round).toEqual({ hand, next: 2 });
    const decisions = (await db.table("decisions").toArray()).filter(row => row.sessionId === session.id).sort((x, y) => x.createdAt - y.createdAt);
    expect(decisions.map(row => row.paytableId)).toEqual([table.id, other.id]);
    // Every table at the machine's bet: the bet can't change mid-round (PR #10 review).
    expect(decisions.map(row => row.coins)).toEqual([5, 5]);
    await expect(sessionService.applyAction(session.id, { type: "bet", coins: 1 })).rejects.toThrow("the machine's bet");
    // The round is done: the next deal starts a new one on the machine's table.
    await answer(play, session.id, 0b01111);
    expect(api.prepareRound).toHaveBeenLastCalledWith(table.id, 5, 1, null, { paytableId: table.id, switcher: { others: [other.id], differ: true } });
  });
  it("an open Switcher keeps its comparison tables: they can't be deleted until it closes", async () => {
    const { machine } = await setup();
    const quick = quickFill(draftFromLibrary("jacks_or_better"), "7/5");
    if ("error" in quick) throw new Error(quick.error);
    const custom = await paytableService.saveCustom({ name: "7/5 Jacks", draft: quick.draft });
    const session = await trainingService.start({ machineId: machine.id, kind: "switcher", compareWith: [custom.id] });
    await expect(paytableService.remove(custom.id)).rejects.toThrow("An open session uses this pay table");
    await sessionService.pause(session.id); // a paused session still counts
    await expect(paytableService.remove(custom.id)).rejects.toThrow("An open session uses this pay table");
    await sessionService.close(session.id);
    await paytableService.remove(custom.id);
    expect(await paytableService.listCustom()).toEqual([]);
  });
});
