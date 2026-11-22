import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { analyzeHandFast, parseHand, resolveRound, standardVariant } from "@perfect-draw/engine";
import { db, initializeDatabase } from "../src/data/db";
import { creditState } from "../src/services/money";
import { walletService } from "../src/services/wallets";
import { machineService } from "../src/services/machines";
import { sessionService } from "../src/services/sessions";
import { backupService } from "../src/services/backup";
import { createPlayService } from "../src/services/play";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
});
async function setup(initialCents = 1240) {
  const table = getLibraryPayTable("jacks-or-better-9-6"), vector = standardVariant.valueVector(table, 5, {});
  const hand = parseHand("2c 3d 5h 7s 9c");
  const wallet = await walletService.create({ name: "Dollar wallet", initialCents });
  const machine = await machineService.save({ name: "Dollar table", paytableId: table.id, defaultWalletId: wallet.id, denominationCents: 100 });
  const session = await sessionService.start({ machineId: machine.id, mode: "free_play" });
  const play = createPlayService(() => ({
    prepareRound: async () => ({ analysis: analyzeHandFast(hand, vector), drawDecks: [Array.from({ length: 52 }, (_, i) => i).filter(card => !hand.includes(card))] }),
    resolveRound: async (cards, mask, decks) => resolveRound(cards, mask, decks, table.familyId, vector),
  }));
  return { wallet, session, play };
}
it("splits whole credits and remainders without rounding money", () => {
  expect(creditState(1240, 100)).toEqual({ credits: 12, creditRemainderCents: 40 });
  expect(creditState(10, 100)).toEqual({ credits: 0, creditRemainderCents: 10 });
  expect(creditState(1240, 25)).toEqual({ credits: 49, creditRemainderCents: 15 });
});
it("preserves cents through session start, wallet ledger changes, bets and zero-payout settlement", async () => {
  const { session, wallet, play } = await setup();
  expect(session.state).toMatchObject({ credits: 12, creditRemainderCents: 40 });
  await walletService.topup({ walletId: wallet.id, amountCents: 60 });
  expect((await db.records("sessions").get(session.id))!.state).toMatchObject({ credits: 13, creditRemainderCents: 0 });
  await sessionService.applyAction(session.id, { type: "feedback", feedbackMode: "show_after_draw" });
  const dealt = await play.deal(session.id, null);
  expect(dealt.state).toMatchObject({ credits: 8, creditRemainderCents: 0 });
  await sessionService.applyAction(session.id, { type: "hold", heldMask: 31 });
  const complete = await play.submit(session.id, dealt.state.handId!);
  expect(complete.state).toMatchObject({ credits: 8, creditRemainderCents: 0 });
  expect((await db.records("wallets").get(wallet.id))!.balanceCents).toBe(800);
});
it("checks the bet against exact cents, not display credits", async () => {
  const { session, wallet, play } = await setup(490);
  expect(session.state).toMatchObject({ credits: 4, creditRemainderCents: 90 });
  await expect(play.deal(session.id, null)).rejects.toThrow();
  expect((await db.records("wallets").get(wallet.id))!.balanceCents).toBe(490);
  expect(await db.records("walletLedger").where("sessionId").equals(session.id).count()).toBe(0);
});
it("normalizes legacy fractional display values when restoring a backup", async () => {
  const { session } = await setup();
  const backup = JSON.parse(await backupService.export());
  backup.tables.sessions[0].state.credits = 12.4;
  delete backup.tables.sessions[0].state.creditRemainderCents;
  await backupService.import(JSON.stringify(backup));
  expect((await db.records("sessions").get(session.id))!.state).toMatchObject({ credits: 12, creditRemainderCents: 40 });
});
