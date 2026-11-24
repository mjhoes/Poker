import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { analyzeHandFast, canonicalizeHand, parseHand, resolveRound, standardVariant } from "@perfect-draw/engine";
import type { GameAnalysis } from "@perfect-draw/engine";
import { analysisKey, getLibraryPayTable } from "@perfect-draw/paytables";
import { decisionSchema, newId } from "@perfect-draw/shared";
import { db, initializeDatabase } from "../src/data/db";
import { machineService } from "../src/services/machines";
import { walletService } from "../src/services/wallets";
import { sessionService } from "../src/services/sessions";
import { createPlayService } from "../src/services/play";
import { decisionService } from "../src/services/decisions";
import { backupService } from "../src/services/backup";
import { rollupDecisions } from "../src/services/retention";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
});
afterEach(() => vi.restoreAllMocks());
async function setup(options: { mode?: "free_play" | "drill"; hand?: string; coins?: number; lines?: 1 | 3 | 5 | 10; initialCents?: number } = {}) {
  const table = getLibraryPayTable("jacks-or-better-9-6");
  const hand = parseHand(options.hand ?? "Ah Kh Qh Jh Th");
  const worker = {
    prepareRound: vi.fn(async (_id: string, coins: number, lines: number) => ({
      analysis: analyzeHandFast(hand, standardVariant.valueVector(table, coins, {})),
      drawDecks: Array.from({ length: lines }, () => Array.from({ length: 52 }, (_, i) => i).filter(card => !hand.includes(card))),
    })),
  };
  // Adapt the worker signature while retaining the actual pure engine payout implementation.
  const api = {
    prepareRound: worker.prepareRound,
    resolveRound: vi.fn(async (cards: typeof hand, mask: number, decks: number[][], _id: string, coins: number) =>
      resolveRound(cards, mask, decks, table.familyId, standardVariant.valueVector(table, coins, {}))),
  };
  const play = createPlayService(() => api);
  const wallet = await walletService.create({ name: "Practice", initialCents: options.initialCents ?? 10000 });
  const machine = await machineService.save({
    name: "Training", paytableId: table.id, defaultWalletId: wallet.id, denominationCents: 25,
    coins: options.coins ?? 5, lines: options.lines ?? 1,
  });
  const session = await sessionService.start({ machineId: machine.id, mode: options.mode ?? "free_play" });
  return { play, wallet, machine, session, api, hand };
}
const stateOf = async (id: string) => (await sessionService.list()).find(x => x.id === id)!;
async function hold(id: string, handId: string, mask: number) {
  await sessionService.applyAction(id, { type: "hold", heldMask: mask, handId });
}
describe("persistent play loop", () => {
  it("bets the credits chosen at the table, locks them for the hand, and records them on the decision", async () => {
    const { play, session, wallet, api } = await setup({ lines: 3 });
    await sessionService.applyAction(session.id, { type: "bet", coins: 2 });
    const dealt = await play.deal(session.id, null), handId = dealt.state.handId!;
    expect(api.prepareRound).toHaveBeenLastCalledWith(expect.any(String), 2, 3, null);
    expect(dealt.state).toMatchObject({ betCoins: 2, handCoins: 2 });
    // 2 coins × 3 lines × 25¢ = $1.50 bet, not the machine's default 5 coins.
    expect(dealt.summary.coinInCents).toBe(150);
    expect((await walletService.list()).find(row => row.id === wallet.id)!.balanceCents).toBe(10000 - 150);
    await expect(sessionService.applyAction(session.id, { type: "bet", coins: 5 })).rejects.toThrow("Finish this hand before changing the bet.");
    await hold(session.id, handId, 0b11111);
    const settled = await play.submit(session.id, handId);
    expect(api.resolveRound).toHaveBeenLastCalledWith(expect.anything(), 0b11111, expect.anything(), expect.any(String), 2);
    // A royal at 2 coins pays 500 per line, not the 5-coin 4,000.
    expect(settled.state.outcome!.lines.map(line => line.payoutCoins)).toEqual([500, 500, 500]);
    expect((await db.records("decisions").get(handId))).toMatchObject({ coins: 2, lines: 3 });
    // Between hands the bet can change again, and the next deal uses it.
    await sessionService.applyAction(session.id, { type: "bet", coins: 5 });
    const next = await play.deal(session.id, handId);
    expect(next.state.handCoins).toBe(5);
    expect(next.summary.coinInCents).toBe(150 + 375);
  });
  it("keeps a focused drill at the bet its training target was found at", async () => {
    const { play, machine, api } = await setup({ mode: "drill" });
    const table = getLibraryPayTable("jacks-or-better-9-6");
    const focus = { label: "RF4", analysisKey: analysisKey(table.familyId, standardVariant.valueVector(table, 5, {}), 5) };
    const focused = await sessionService.start({ machineId: machine.id, mode: "drill", trainingFocus: focus });
    await expect(sessionService.applyAction(focused.id, { type: "bet", coins: 2 })).rejects.toThrow("A focused drill keeps the bet it was set up for.");
    // A session saved before this rule, with a different bet already chosen, still deals at the focus's bet and key.
    await db.records("sessions").put({ ...(await stateOf(focused.id)), state: { ...(await stateOf(focused.id)).state, betCoins: 2 } });
    const dealt = await play.deal(focused.id, null);
    expect(api.prepareRound).toHaveBeenLastCalledWith(expect.any(String), 5, 1, focus);
    expect(dealt.state.handCoins).toBe(5);
  });
  it("can settle an old warned hand after retention without losing its original mistake", async () => {
    const { play, session } = await setup();
    const dealt = await play.deal(session.id, null), handId = dealt.state.handId!;
    await hold(session.id, handId, 0);
    await play.submit(session.id, handId);
    const warned = await stateOf(session.id), first = (await db.records("decisions").get(handId))!;
    // Simulate a pre-cleanup session that waited more than 90 days at its warning.
    await db.records("sessions").update(session.id, { state: { ...warned.state, primaryGrade: null } });
    await db.records("decisions").update(handId, { createdAt: Date.now() - 91 * 86_400_000 });
    const analysis = dealt.state.analysis!;
    const second = [...analysis.results].sort((a, b) => b.ev - a.ev)[1];
    const game: GameAnalysis = {
      engineVersion: "4.0.0", familyId: analysis.familyId, valueVector: analysis.valueVector, betCoins: 5,
      returnPct: 99.5, variance: 19, hitFreq: 0.45, rankProbs: [],
      perHand: new Map([[canonicalizeHand(analysis.hand).id, { bestLabel: analysis.best.label, weight: 4,
        bestMask: analysis.best.mask, secondMask: second.mask, ev: analysis.best.ev,
        secondEv: second.ev, secondLabel: second.label }]]),
    };
    await rollupDecisions("America/New_York", async () => ({ key: first.analysisKey, analysis: game }));
    expect(await db.records("decisions").get(handId)).toBeUndefined();
    expect((await stateOf(session.id)).state.primaryGrade).not.toBeNull();
    const settled = await play.submit(session.id, handId, true);
    expect(settled.summary).toMatchObject({ hands: 1, errors: 1 });
    expect(settled.summary.evLost).toBeGreaterThan(0);
    expect(await db.records("decisions").count()).toBe(0);
    expect((await db.records("dailyAggregates").toArray())[0]).toMatchObject({ n: 1, errors: 1 });
  });
  it.each([1, 3, 5, 10] as const)("atomically charges %i lines, persists the round and pays exactly once", async lines => {
    const { play, session, wallet } = await setup({ lines });
    const dealt = await play.deal(session.id, null);
    expect((await walletService.list())[0].balanceCents).toBe(10000 - 125 * lines);
    expect(dealt.state.drawDecks).toHaveLength(lines);
    db.close(); await db.open();
    expect((await stateOf(session.id)).state).toEqual(dealt.state);
    await hold(session.id, dealt.state.handId!, 31);
    await Promise.all([play.submit(session.id, dealt.state.handId!), play.submit(session.id, dealt.state.handId!)]);
    const done = await stateOf(session.id);
    expect(done.state.outcome?.totalPayoutCoins).toBe(4000 * lines);
    expect(done.summary).toMatchObject({ hands: 1, coinInCents: 125 * lines, netCents: 99875 * lines, errors: 0, biggestWinCents: 100000 * lines });
    expect((await db.records("wallets").get(wallet.id))?.balanceCents).toBe(10000 + 99875 * lines);
    expect(await db.records("walletLedger").count()).toBe(3);
    const rows = await decisionService.query();
    expect(rows).toHaveLength(1);
    expect(decisionSchema.safeParse(rows[0]).success).toBe(true);
    expect(rows[0]).toMatchObject({ handId: dealt.state.handId, chosenMask: 31, bestMask: 31, evLoss: 0, coins: 5, lines, variantKind: "standard", handIndexInSession: 1, isCorrection: false, attemptIndex: 0 });
    const table = getLibraryPayTable("jacks-or-better-9-6");
    expect(rows[0].analysisKey).toBe(analysisKey(table.familyId, standardVariant.valueVector(table, 5, {}), 5));
    expect(rows[0].canonicalHandId).toBeGreaterThan(0);
    await sessionService.close(session.id);
    expect((await stateOf(session.id)).summary).toEqual(done.summary);
  });
  it("keeps original warned mistakes and logs corrections without double-counting the hand", async () => {
    const { play, session } = await setup({ hand: "Ah Kh Qh Jh Ts" });
    const dealt = await play.deal(session.id, null); const handId = dealt.state.handId!;
    await hold(session.id, handId, 31);
    const warned = await play.submit(session.id, handId);
    expect(warned.state.warning?.correct).toBe(false);
    expect(warned.state.phase).toBe("holding");
    expect(warned.summary.hands).toBe(0);
    expect(await db.records("decisions").count()).toBe(1);
    await play.submit(session.id, handId);
    expect(await db.records("decisions").count()).toBe(1);
    await hold(session.id, handId, 15);
    const done = await play.submit(session.id, handId);
    const all = await decisionService.query({ sessionId: session.id, includeCorrections: true });
    expect(all).toHaveLength(2);
    expect(all[0].isCorrection).toBe(false); expect(all[0].evLoss).toBeGreaterThan(0);
    expect(all[1]).toMatchObject({ isCorrection: true, attemptIndex: 1, chosenMask: 15, evLoss: 0 });
    expect(await decisionService.query()).toHaveLength(1);
    expect(done.summary).toMatchObject({ hands: 1, errors: 1, evLost: all[0].evLoss });
    expect(done.state.feedback?.correct).toBe(true);
  });
  it("draws a confirmed warned hold without another decision or another bet", async () => {
    const { play, session } = await setup({ hand: "Ah Kh Qh Jh Ts" });
    const dealt = await play.deal(session.id, null); const handId = dealt.state.handId!;
    await hold(session.id, handId, 31);
    await expect(play.submit(session.id, handId, true)).rejects.toThrow(/Review/);
    await play.submit(session.id, handId);
    const done = await play.submit(session.id, handId, true);
    expect(done.state.outcome?.lines[0].rank).toBe("STRAIGHT");
    expect(await db.records("decisions").count()).toBe(1);
    expect((await db.records("walletLedger").toArray()).filter(x => x.type === "bet")).toHaveLength(1);
  });
  it.each(["show_after_draw", "silent_report"] as const)("settles %s decisions without a blocking warning", async mode => {
    const { play, session } = await setup({ hand: "Ah Kh Qh Jh Ts" });
    await sessionService.applyAction(session.id, { type: "feedback", feedbackMode: mode });
    const dealt = await play.deal(session.id, null);
    await hold(session.id, dealt.state.handId!, 31);
    const done = await play.submit(session.id, dealt.state.handId!);
    expect(done.state).toMatchObject({ phase: "complete", warning: null, feedbackMode: mode });
    expect(done.state.feedback?.correct).toBe(false);
    expect(done.summary.errors).toBe(1);
  });
  it("checks drills instantly without touching any wallet or logging bets/wins", async () => {
    const { play, session } = await setup({ mode: "drill", initialCents: 0 });
    const dealt = await play.deal(session.id, null);
    const done = await play.submit(session.id, dealt.state.handId!);
    expect(done.state).toMatchObject({ phase: "complete", outcome: null, warning: null });
    expect(done.state.feedback?.evLoss).toBeGreaterThan(0);
    expect(done.summary).toMatchObject({ hands: 1, errors: 1, coinInCents: 0, netCents: 0 });
    expect(await db.records("walletLedger").count()).toBe(0);
    expect((await walletService.list())[0].balanceCents).toBe(0);
  });
  it.each([1, 2, 3, 4, 5])("uses the actual %i-coin payout and analysis key", async coins => {
    const { play, session } = await setup({ coins });
    const dealt = await play.deal(session.id, null);
    await hold(session.id, dealt.state.handId!, 31);
    const done = await play.submit(session.id, dealt.state.handId!);
    const expectedPayout = [250, 500, 750, 1000, 4000][coins - 1];
    expect(done.state.outcome?.totalPayoutCoins).toBe(expectedPayout);
    const [decision] = await decisionService.query();
    expect(decision.chosenEv).toBe(expectedPayout);
    expect(decision.coins).toBe(coins);
    expect(decision.analysisKey).toBe(analysisKey(dealt.state.analysis!.familyId, dealt.state.analysis!.valueVector, coins));
    expect(done.summary.coinInCents).toBe(25 * coins);
  });
  it("excludes paused time from the decision timer, but keeps wall-clock session context", async () => {
    const { play, session } = await setup();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const dealt = await play.deal(session.id, null);
    now += 400;
    await sessionService.pause(session.id);
    now += 10000;
    await sessionService.resume(session.id);
    now += 600;
    await hold(session.id, dealt.state.handId!, 31);
    await play.submit(session.id, dealt.state.handId!);
    const [decision] = await decisionService.query();
    expect(decision.decisionMs).toBe(1000);
    expect(decision.msSinceSessionStart).toBeGreaterThanOrEqual(11000);
  });
  it("rejects unfunded bets, stale holds, manual overwrites and closing a paid pending hand", async () => {
    const empty = await setup({ initialCents: 0 });
    await expect(empty.play.deal(empty.session.id, null)).rejects.toThrow(/Insufficient/);
    expect((await stateOf(empty.session.id)).state.handId).toBeNull();
    const { play, session } = await setup();
    const dealt = await play.deal(session.id, null);
    await expect(hold(session.id, newId(), 31)).rejects.toThrow(/no longer/);
    await expect(sessionService.close(session.id)).rejects.toThrow(/Finish/);
    await expect(sessionService.applyAction(session.id, { type: "saveHand", hand: [1, 2, 3, 4, 5] })).rejects.toThrow(/game loop/);
    await sessionService.pause(session.id);
    await expect(play.submit(session.id, dealt.state.handId!)).rejects.toThrow(/Resume/);
  });
  it("does not charge duplicate deals or reroll a failed draw", async () => {
    const { play, session, api } = await setup();
    await Promise.allSettled([play.deal(session.id, null), play.deal(session.id, null)]);
    const dealt = await stateOf(session.id);
    expect((await db.records("walletLedger").toArray()).filter(x => x.type === "bet")).toHaveLength(1);
    await hold(session.id, dealt.state.handId!, 31);
    api.resolveRound.mockRejectedValueOnce(new Error("worker stopped"));
    await expect(play.submit(session.id, dealt.state.handId!)).rejects.toThrow(/worker/);
    expect(await db.records("decisions").count()).toBe(0);
    const done = await play.submit(session.id, dealt.state.handId!);
    expect(done.state.outcome?.totalPayoutCoins).toBe(4000);
    expect(api.resolveRound.mock.calls[0][2]).toEqual(api.resolveRound.mock.calls[1][2]);
  });
  it("rolls back decision, payout and summary together on balance overflow", async () => {
    const { play, session, wallet } = await setup({ initialCents: Number.MAX_SAFE_INTEGER });
    const dealt = await play.deal(session.id, null);
    await hold(session.id, dealt.state.handId!, 31);
    await expect(play.submit(session.id, dealt.state.handId!)).rejects.toThrow();
    expect(await db.records("decisions").count()).toBe(0);
    expect((await stateOf(session.id)).state.phase).toBe("holding");
    expect((await db.records("wallets").get(wallet.id))?.balanceCents).toBe(Number.MAX_SAFE_INTEGER - 125);
  });
  it("preserves pending warning, draw order and decisions in backups", async () => {
    const { play, session } = await setup({ hand: "Ah Kh Qh Jh Ts" });
    const dealt = await play.deal(session.id, null);
    await hold(session.id, dealt.state.handId!, 31);
    const warned = await play.submit(session.id, dealt.state.handId!);
    const backup = await backupService.export();
    await play.submit(session.id, dealt.state.handId!, true);
    await backupService.import(backup);
    expect((await stateOf(session.id)).state).toEqual(warned.state);
    expect(await db.records("decisions").count()).toBe(1);
    const restored = await play.submit(session.id, dealt.state.handId!, true);
    expect(restored.summary.hands).toBe(1);
  });
});
