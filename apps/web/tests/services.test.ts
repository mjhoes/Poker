import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { newId } from "@perfect-draw/shared";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { db, initializeDatabase } from "../src/data/db";
import { machineService } from "../src/services/machines";
import { postLedger, walletService } from "../src/services/wallets";
import { sessionService } from "../src/services/sessions";
import { backupService } from "../src/services/backup";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
});
async function fixture() {
  const wallet = await walletService.create({ name: "Practice", initialCents: 10000 });
  const machine = await machineService.save({ name: "Quarter Jacks", paytableId: PAY_TABLE_LIBRARY[0].id, denominationCents: 25, defaultWalletId: wallet.id });
  const session = await sessionService.start({ machineId: machine.id });
  return { wallet, machine, session };
}
describe("local services", () => {
  it("initializes all tables, only library/profile/settings data, and is idempotent", async () => {
    await Promise.all([initializeDatabase(), initializeDatabase()]);
    expect(db.tables).toHaveLength(22);
    expect(await db.records("paytables").count()).toBe(8);
    expect(await db.records("profile").count()).toBe(1);
    expect(await walletService.list()).toEqual([]);
    expect(await machineService.list()).toEqual([]);
  });
  it("posts exact-cent topups and two matching transfer entries", async () => {
    const a = await walletService.create({ name: "A", initialCents: 10000 });
    const b = await walletService.create({ name: "B" });
    await walletService.topup({ walletId: a.id, amountCents: 25 });
    await walletService.transfer({ fromId: a.id, toId: b.id, amountCents: 4025 });
    expect((await db.records("wallets").get(a.id))?.balanceCents).toBe(6000);
    expect((await db.records("wallets").get(b.id))?.balanceCents).toBe(4025);
    const transfers = (await db.records("walletLedger").toArray()).filter(x => x.type === "transfer");
    expect(transfers).toHaveLength(2);
    expect(transfers[0].transferId).toBe(transfers[1].transferId);
    expect(transfers.reduce((sum, row) => sum + row.amountCents, 0)).toBe(0);
  });
  it("rolls back both wallets on insufficient funds, missing receiver, or overflow", async () => {
    const a = await walletService.create({ name: "A", initialCents: 100 });
    const b = await walletService.create({ name: "B", initialCents: Number.MAX_SAFE_INTEGER });
    await expect(walletService.transfer({ fromId: a.id, toId: b.id, amountCents: 101 })).rejects.toThrow();
    await expect(walletService.transfer({ fromId: a.id, toId: newId(), amountCents: 1 })).rejects.toThrow();
    await expect(walletService.transfer({ fromId: a.id, toId: b.id, amountCents: 1 })).rejects.toThrow();
    expect((await db.records("wallets").get(a.id))?.balanceCents).toBe(100);
    expect(await db.records("walletLedger").count()).toBe(2);
  });
  it("serializes concurrent transfers without overspending", async () => {
    const a = await walletService.create({ name: "A", initialCents: 100 });
    const b = await walletService.create({ name: "B" });
    const result = await Promise.allSettled(Array.from({ length: 10 }, () => walletService.transfer({ fromId: a.id, toId: b.id, amountCents: 30 })));
    expect(result.filter(x => x.status === "fulfilled")).toHaveLength(3);
    expect((await db.records("wallets").get(a.id))?.balanceCents).toBe(10);
    expect((await db.records("wallets").get(b.id))?.balanceCents).toBe(90);
    expect(await db.records("walletLedger").count()).toBe(7);
  });
  it("rejects invalid financial inputs and self-transfers", async () => {
    const wallet = await walletService.create({ name: "A" });
    for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(walletService.topup({ walletId: wallet.id, amountCents: amount })).rejects.toThrow();
    }
    await expect(walletService.transfer({ fromId: wallet.id, toId: wallet.id, amountCents: 1 })).rejects.toThrow();
    await walletService.rename(wallet.id, "Trip fund");
    expect((await walletService.list())[0].name).toBe("Trip fund");
    expect(await db.records("walletLedger").count()).toBe(0);
  });
  it("preserves exact mid-hold state, isolated sessions and active selection across database reopen", async () => {
    const { machine, session } = await fixture();
    await sessionService.applyAction(session.id, { type: "saveHand", hand: [48, 45, 42, 39, 2], heldMask: 15 });
    const second = await sessionService.start({ machineId: machine.id, mode: "drill" });
    await sessionService.activate(session.id);
    db.close(); await db.open();
    expect((await db.records("sessions").get(session.id))?.state).toMatchObject({ hand: [48, 45, 42, 39, 2], heldMask: 15, phase: "holding", credits: 400, variantState: {} });
    expect((await db.records("sessions").get(second.id))?.state.hand).toEqual([]);
    expect((await db.records("profile").get("local"))?.prefs.activeSessionId).toBe(session.id);
  });
  it("keeps machine terms frozen and synchronizes shared-wallet credits on every ledger action", async () => {
    const { machine, wallet, session } = await fixture();
    const other = await sessionService.start({ machineId: machine.id });
    await machineService.save({ ...machine, denominationCents: 100 }, machine.id);
    await walletService.topup({ walletId: wallet.id, amountCents: 100 });
    for (const id of [session.id, other.id]) {
      const saved = await db.records("sessions").get(id);
      expect(saved?.machineSnapshot.denominationCents).toBe(25);
      expect(saved?.state.credits).toBe(404);
    }
    const third = await sessionService.start({ machineId: machine.id });
    expect(third.state.credits).toBe(101);
  });
  it("persists hold changes, pause/resume/close and selects another session on close", async () => {
    const { machine, session } = await fixture();
    await sessionService.applyAction(session.id, { type: "saveHand", hand: [1, 5, 9, 13, 17] });
    await sessionService.applyAction(session.id, { type: "hold", heldMask: 31 });
    await sessionService.pause(session.id);
    await expect(sessionService.applyAction(session.id, { type: "hold", heldMask: 0 })).rejects.toThrow(/Resume/);
    await sessionService.resume(session.id);
    expect((await db.records("sessions").get(session.id))?.state.heldMask).toBe(31);
    const other = await sessionService.start({ machineId: machine.id });
    await sessionService.close(other.id);
    expect((await db.records("profile").get("local"))?.prefs.activeSessionId).toBe(session.id);
    expect((await db.records("sessions").get(other.id))?.endedAt).toBeTypeOf("number");
    await expect(sessionService.resume(other.id)).rejects.toThrow(/closed/);
    await expect(sessionService.activate(other.id)).rejects.toThrow(/closed/);
  });
  it("validates machines, protects open sessions, and tombstones deletions", async () => {
    const { machine, session } = await fixture();
    await expect(machineService.save({ ...machine, variant: { kind: "ultimate_x" } })).rejects.toThrow(/not supported/);
    await expect(machineService.save({ ...machine, defaultWalletId: newId() })).rejects.toThrow();
    await expect(machineService.remove(machine.id)).rejects.toThrow(/Close/);
    await sessionService.close(session.id);
    await machineService.remove(machine.id);
    expect(await machineService.list()).toHaveLength(0);
    expect((await db.records("machines").get(machine.id))?.deletedAt).toBeTypeOf("number");
    await expect(sessionService.start({ machineId: machine.id })).rejects.toThrow(/deleted/);
  });
  it("round-trips all user data, tombstones and binary uploads while excluding keys/caches", async () => {
    const { machine, session, wallet } = await fixture();
    await sessionService.applyAction(session.id, { type: "saveHand", hand: [1, 5, 9, 13, 17], heldMask: 3 });
    await db.records("aiKeys").put({ provider: "openai", key: "TEST_ONLY_NOT_A_REAL_KEY", updatedAt: 0, deletedAt: null });
    await db.records("aiSettings").update("local", { rememberKeys: true });
    const id = newId();
    await db.records("uploads").put({ id, updatedAt: 0, deletedAt: null, kind: "hand", imageBlob: new Blob(["test image"], { type: "image/png" }), extracted: {}, confirmed: false, provider: "none", model: "", createdAt: 0, expiresAt: 1 });
    const exported = await backupService.export();
    expect(exported).not.toContain("TEST_ONLY_NOT_A_REAL_KEY");
    expect(JSON.parse(exported).tables).not.toHaveProperty("aiKeys");
    expect(JSON.parse(exported).tables).not.toHaveProperty("analyses");
    await walletService.topup({ walletId: wallet.id, amountCents: 1000 });
    await backupService.import(exported);
    expect((await walletService.list())[0].balanceCents).toBe(10000);
    expect((await machineService.list())[0].id).toBe(machine.id);
    expect((await db.records("sessions").get(session.id))?.state.heldMask).toBe(3);
    expect(await db.records("aiKeys").count()).toBe(0);
    expect((await db.records("aiSettings").get("local"))?.rememberKeys).toBe(false);
    expect(await (await db.records("uploads").get(id))?.imageBlob?.text()).toBe("test image");
  });
  it("rejects malformed, incomplete, orphaned and financially inconsistent backups without changing anything", async () => {
    await fixture();
    const raw = await backupService.export();
    const mutate = (change: (value: ReturnType<typeof JSON.parse>) => void) => { const parsed = JSON.parse(raw); change(parsed); return JSON.stringify(parsed); };
    const invalid = [
      "{", mutate(x => x.version = 99), mutate(x => delete x.tables.wallets),
      mutate(x => x.tables.machines[0].defaultWalletId = newId()),
      mutate(x => x.tables.wallets[0].balanceCents++),
      mutate(x => x.tables.walletLedger.push(x.tables.walletLedger[0])),
      mutate(x => x.tables.walletLedger[0].balanceAfterCents++),
      mutate(x => x.tables.sessions[0].state.hand = [1, 1, 1, 1, 1]),
    ];
    for (const text of invalid) {
      await expect(backupService.import(text)).rejects.toThrow();
      expect((await walletService.list())[0].balanceCents).toBe(10000);
      expect(await db.records("sessions").count()).toBe(1);
    }
  });
  it("rejects an unbalanced transfer backup", async () => {
    const { wallet } = await fixture();
    const b = await walletService.create({ name: "B" });
    await walletService.transfer({ fromId: wallet.id, toId: b.id, amountCents: 100 });
    const raw = JSON.parse(await backupService.export());
    raw.tables.walletLedger.find((x: { walletId: string; type: string }) => x.walletId === b.id && x.type === "transfer").transferId = newId();
    await expect(backupService.import(JSON.stringify(raw))).rejects.toThrow(/balanced/);
  });
  it("refuses non-transactional ledger writes", async () => {
    const { wallet } = await fixture();
    await expect(postLedger(wallet.id, 1, "topup")).rejects.toThrow(/atomic/);
    expect((await walletService.list())[0].balanceCents).toBe(10000);
  });
  it("rolls back a restore if an IndexedDB uniqueness constraint fails", async () => {
    await fixture();
    const raw = JSON.parse(await backupService.export());
    const mastery = { updatedAt: 0, deletedAt: null, familyId: "jacks_or_better", label: "HP", alpha: 1, beta: 1, lastSeenAt: 0, fsrsStability: 1, fsrsDifficulty: 1, dueAt: 0 };
    raw.tables.categoryMastery = [{ ...mastery, id: newId() }, { ...mastery, id: newId() }];
    await expect(backupService.import(JSON.stringify(raw))).rejects.toThrow();
    expect((await walletService.list())[0].balanceCents).toBe(10000);
    expect(await db.records("sessions").count()).toBe(1);
    expect(await db.records("categoryMastery").count()).toBe(0);
  });
});

describe("Casino-Pace sessions", () => {
  it("start as Free Play with the target, accuracy bar and chosen feedback; drills can't carry a pace", async () => {
    const { machine, wallet } = await fixture();
    const session = await sessionService.start({ machineId: machine.id, walletId: wallet.id, mode: "free_play", feedbackMode: "silent_report", pace: { targetHandsPerHour: 750, accuracyPct: 99.9 } });
    expect(session.mode).toBe("free_play");
    expect(session.pace).toEqual({ targetHandsPerHour: 750, accuracyPct: 99.9 });
    expect(session.state.feedbackMode).toBe("silent_report");
    await expect(sessionService.start({ machineId: machine.id, mode: "drill", pace: { targetHandsPerHour: 750, accuracyPct: 99.9 } })).rejects.toThrow("Free Play");
    await expect(sessionService.start({ machineId: machine.id, mode: "free_play", pace: { targetHandsPerHour: 50, accuracyPct: 99.9 } })).rejects.toThrow();
    // Sessions saved before pace existed read as ordinary Free Play.
    expect((await sessionService.list()).filter(row => row.pace === null)).toHaveLength(1);
  });
});
