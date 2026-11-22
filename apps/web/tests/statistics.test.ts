import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizeHand, parseHand, standardVariant } from "@perfect-draw/engine";
import type { GameAnalysis } from "@perfect-draw/engine";
import { analysisKey, getLibraryPayTable } from "@perfect-draw/paytables";
import { decisionSchema, newId } from "@perfect-draw/shared";
import type { Session } from "@perfect-draw/shared";
import { db, initializeDatabase, LocalDatabase, stamp } from "../src/data/db";
import { machineService } from "../src/services/machines";
import { walletService } from "../src/services/wallets";
import { sessionService } from "../src/services/sessions";
import { statsService } from "../src/services/statistics";
import { backupService } from "../src/services/backup";
import { StatsEngine } from "../src/worker/stats-engine";
import * as client from "../src/worker/client";
import type { EngineAPI } from "../src/worker/engine-api";

const table = getLibraryPayTable("jacks-or-better-9-6");
const hand = parseHand("Ac Ad 3h 7s 9c");
const other = parseHand("2c 4d 7h 9s Tc");
const firstId = canonicalizeHand(hand).id, otherId = canonicalizeHand(other).id;
const vector = standardVariant.valueVector(table, 5, {});
const key = analysisKey(table.familyId, vector, 5);
const game = {
  engineVersion: "4.0.0", familyId: table.familyId, valueVector: vector, betCoins: 5, returnPct: 99.5,
  perHand: new Map([
    [firstId, { bestLabel: "PAIR_A", secondLabel: "DRAW5", weight: 24, bestMask: 3, secondMask: 0, ev: 7, secondEv: 2 }],
    [otherId, { bestLabel: "DRAW5", secondLabel: "OTHER_1", weight: 4, bestMask: 0, secondMask: 1, ev: 2, secondEv: 1 }],
  ]), variance: 19, hitFreq: 0.45, rankProbs: [],
} satisfies GameAnalysis;
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
});
afterEach(() => vi.restoreAllMocks());
async function setup(coins = 5) {
  const wallet = await walletService.create({ name: "Statistics wallet", initialCents: 10000 });
  const machine = await machineService.save({ name: "Stats table", paytableId: table.id, coins, denominationCents: 25, defaultWalletId: wallet.id });
  const session = await sessionService.start({ machineId: machine.id, mode: "drill" });
  return { wallet, machine, session };
}
function decision(session: Session, options: { loss?: number; at?: number; correction?: boolean; other?: boolean; key?: string; deleted?: boolean } = {}) {
  return decisionSchema.parse({
    id: newId(), ...stamp(), deletedAt: options.deleted ? Date.now() : null, sessionId: session.id,
    paytableId: table.id, analysisKey: options.key ?? key, canonicalHandId: options.other ? otherId : firstId,
    dealtCards: options.other ? other : hand, chosenMask: 0, bestMask: options.other ? 0 : 3,
    chosenEv: 7 - (options.loss ?? 1), bestEv: 7, evLoss: options.loss ?? 1,
    bestLabel: "ORIGINAL_ORDER_TIE_LABEL", chosenLabel: "DRAW5", gapToSecond: 1,
    decisionMs: 150, handIndexInSession: 1, msSinceSessionStart: 150, priorOutcome: null,
    createdAt: options.at ?? Date.now(), isCorrection: options.correction ?? false, coins: session.machineSnapshot.coins,
  });
}
describe("statistics worker and local service", () => {
  it("uses canonical optimal categories and multiplicity frequencies without changing saved labels", async () => {
    const { session } = await setup();
    const original = decision(session);
    await db.records("decisions").bulkAdd([original, decision(session, { other: true, loss: 0 })]);
    const loader = vi.fn(async () => game);
    const worker = new StatsEngine(loader);
    const report = await worker.report({ paytableId: table.id });
    expect(report).toMatchObject({ n: 2, errors: 1, coins: 5, frequencyCoverage: 1 });
    expect(report.categories.find(row => row.label === "PAIR_A")?.frequency).toBeCloseTo(24 / 28);
    expect(report.realPlayWeightedReturnPct).toBeCloseTo(99.5 - 100 * (24 / 28) / 5);
    expect((await db.records("decisions").get(original.id))?.bestLabel).toBe("ORIGINAL_ORDER_TIE_LABEL");
    await worker.report({ paytableId: table.id });
    expect(loader).toHaveBeenCalledOnce();
  });
  it("filters dates, modes, coins, deleted records and baselines while preserving correction counts", async () => {
    const { session, machine } = await setup();
    const free = await sessionService.start({ machineId: machine.id, mode: "free_play" });
    const short = await setup(1);
    const now = Date.now(), day = 86_400_000;
    await db.records("decisions").bulkAdd([
      decision(session, { at: now - 5 * day }), decision(session, { other: true, loss: 0 }),
      decision(session, { correction: true, loss: 0 }), decision(session, { key: "f".repeat(64) }),
      decision(session, { deleted: true }), decision(free, { loss: 2 }), decision(short.session),
    ]);
    const worker = new StatsEngine(async () => game);
    const report = await worker.report({ paytableId: table.id, since: now - 2 * day, mode: "drill" });
    expect(report).toMatchObject({ n: 1, errors: 0, excludedCorrections: 1, excludedIncompatible: 1 });
    expect(report.realPlayWeightedReturnPct).toBeNull();
    const old = await worker.report({ paytableId: table.id, until: now - 3 * day, mode: "drill" });
    expect(old).toMatchObject({ n: 1, errors: 1, excludedCorrections: 0 });
  });
  it("validates category training before opening a session and persists the exact focus in backups", async () => {
    const { machine } = await setup();
    const validateTraining = vi.fn(async () => key);
    vi.spyOn(client, "engineClient").mockReturnValue({ validateTraining } as unknown as EngineAPI);
    const focused = await statsService.train({ machineId: machine.id, label: "PAIR_A" });
    expect(validateTraining).toHaveBeenCalledWith(table.id, 5, "PAIR_A");
    expect(focused.mode).toBe("drill");
    expect(focused.trainingFocus).toEqual({ label: "PAIR_A", analysisKey: key });
    expect(await db.records("walletLedger").count()).toBe(1); // Only the opening top-up.
    const backup = await backupService.export();
    await sessionService.close(focused.id);
    await backupService.import(backup);
    const restored = (await sessionService.list()).find(row => row.id === focused.id)!;
    expect(restored.trainingFocus).toEqual(focused.trainingFocus);
    expect(restored.status).toBe("active");
  });
  it("rejects nonexistent targets and stale machine terms instead of silently changing the drill", async () => {
    const { machine } = await setup();
    const worker = new StatsEngine(async () => game);
    await expect(worker.validateTraining(table.id, 5, "MISSING")).rejects.toThrow(/No hands/);
    await expect(worker.validateTraining(table.id, 5, "PAIR_A")).resolves.toBe(key);
    vi.spyOn(client, "engineClient").mockReturnValue({
      validateTraining: async () => {
        await machineService.save({ ...machine, coins: 1 }, machine.id);
        return key;
      },
    } as unknown as EngineAPI);
    await expect(statsService.train({ machineId: machine.id, label: "PAIR_A" })).rejects.toThrow(/terms changed/);
    expect(await db.records("sessions").count()).toBe(1);
  });
  it("rejects malformed query inputs before creating a worker", async () => {
    const spy = vi.spyOn(client, "engineClient");
    await expect(statsService.report({ paytableId: table.id, coins: 0 })).rejects.toThrow();
    await expect(statsService.report({ paytableId: table.id, since: 2, until: 1 })).rejects.toThrow(/Start date/);
    expect(spy).not.toHaveBeenCalled();
  });
  it("upgrades existing IndexedDB data without deleting decisions", async () => {
    const { session } = await setup();
    const row = decision(session);
    const name = `stats-upgrade-${newId()}`;
    const stores = Object.fromEntries(db.tables.map(store => [
      store.name, [store.schema.primKey.src, ...store.schema.indexes.filter(index =>
        store.name !== "decisions" || !["paytableId", "analysisKey"].includes(index.name)).map(index => index.src)].join(","),
    ]));
    const old = new Dexie(name); old.version(1).stores(stores);
    await old.table("decisions").add(row); old.close();
    const upgraded = new LocalDatabase(name);
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(2);
      expect(await upgraded.records("decisions").get(row.id)).toEqual(row);
      expect(await upgraded.records("decisions").where("paytableId").equals(table.id).count()).toBe(1);
    } finally { upgraded.close(); await upgraded.delete(); }
  });
});
