import Dexie from "dexie";
import type { Table } from "dexie";
import { aiSettingsSchema, newId, paytableSchema, profileSchema, recordSchemas, rewardsProgramSchema } from "@perfect-draw/shared";
import type { Records, TableName } from "@perfect-draw/shared";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { creditState } from "../services/money";

export class LocalDatabase extends Dexie {
  constructor(name = "perfect-draw") {
    super(name);
    this.version(1).stores({
      profile: "id", aiSettings: "id", aiKeys: "provider", aiUsage: "id, createdAt, task",
      paytables: "id, familyId, source", analyses: "key, paytableId, engineVersion",
      machines: "id, paytableId, defaultWalletId, deletedAt", wallets: "id, deletedAt",
      walletLedger: "id, walletId, sessionId, transferId, createdAt",
      sessions: "id, machineId, walletId, status, updatedAt",
      decisions: "id, sessionId, [paytableId+bestLabel], [paytableId+bestLabel+chosenLabel], createdAt",
      categoryMastery: "id, &[familyId+label], dueAt", heuristicCards: "id, paytableId, status",
      uploads: "id, expiresAt", scoutingLog: "id, paytableId, seenAt",
      rewardsPrograms: "id", trips: "id, programId, status", casinoSessions: "id, tripId",
      rewardsReceived: "id, tripId, programId", dailyAggregates: "id, [paytableId+bestLabel+chosenLabel], day",
    });
    this.version(2).stores({
      decisions: "id, sessionId, paytableId, analysisKey, [paytableId+bestLabel], [paytableId+bestLabel+chosenLabel], createdAt",
    });
    this.version(3).stores({
      dailyAggregates: "id, &bucketKey, paytableId, [paytableId+bestLabel+chosenLabel], day",
    }).upgrade(async tx => {
      const wallets = new Map((await tx.table("wallets").toArray()).map(wallet => [wallet.id, wallet]));
      await tx.table("sessions").toCollection().modify(session => {
        const denomination = session.machineSnapshot.denominationCents;
        const cents = session.status !== "closed" && wallets.has(session.walletId)
          ? wallets.get(session.walletId)!.balanceCents
          : Math.round(session.state.credits * denomination) + (session.state.creditRemainderCents ?? 0);
        Object.assign(session.state, creditState(cents, denomination));
      });
    });
    // Saved AI explanations (keyed by the comparison they explain); a cache, not part of backups.
    this.version(4).stores({ aiExplanations: "id, createdAt" });
    // Photos default to the medium model (settings rows written earlier stored the old heavy default, unused so far).
    this.version(5).stores({}).upgrade(async tx => {
      await tx.table("aiSettings").toCollection().modify(settings => { settings.visionTier = "medium"; });
    });
    // Cruise tracker: casino sessions in time order. The early placeholder rounding "trip_floor" becomes "carryover".
    this.version(6).stores({ casinoSessions: "id, tripId, startedAt" }).upgrade(async tx => {
      await tx.table("rewardsPrograms").toCollection().modify(program => { if (program.rounding === "trip_floor") program.rounding = "carryover"; });
    });
    // Saved AI coach reports (docs/19-CONTEXT-ANALYSIS-PLAN.md), newest first per table.
    this.version(7).stores({ coachReports: "id, createdAt, scope.paytableId" });
  }
  records<K extends TableName>(name: K): Table<Records[K], string> { return this.table(name); }
}
export const db = new LocalDatabase();
export const live = <T extends { deletedAt?: number | null }>(row: T) => row.deletedAt == null;
export function stamp() { return { updatedAt: Date.now(), deletedAt: null }; }

/** The built-in rewards program. Every rule is editable; tier thresholds are as commonly published (check current terms). */
export const CLUB_ROYALE = {
  name: "Royal Caribbean Club Royale", casinoName: "Casino Royale", dollarsPerPoint: 15, rounding: "carryover",
  freePlayEarnsPoints: false, isBuiltIn: true,
  tiers: [{ name: "Prime", points: 2500 }, { name: "Signature", points: 25000 }, { name: "Masters", points: 100000 }],
  notes: "1 point per $15 of coin-in; free play earns no points. Tier thresholds: check the current Club Royale terms.",
} as const;

export async function initializeDatabase(database = db) {
  await database.transaction("rw", database.tables, async () => {
    const now = Date.now();
    if (!await database.records("profile").get("local")) {
      await database.records("profile").add(profileSchema.parse({ id: "local", createdAt: now, updatedAt: now }));
    }
    if (!await database.records("aiSettings").get("local")) {
      await database.records("aiSettings").add(aiSettingsSchema.parse({ id: "local", updatedAt: now }));
    }
    if (!(await database.records("rewardsPrograms").toArray()).some(program => program.isBuiltIn)) {
      await database.records("rewardsPrograms").add(rewardsProgramSchema.parse({ id: newId(), createdAt: now, ...stamp(), ...CLUB_ROYALE }));
    }
    for (const table of PAY_TABLE_LIBRARY) {
      if (!await database.records("paytables").get(table.id)) {
        await database.records("paytables").add(paytableSchema.parse({ ...table, createdAt: now, updatedAt: now }));
      }
    }
  });
}
export async function requireRecord<K extends TableName>(name: K, id: string) {
  const value = await db.records(name).get(id);
  if (!value || !live(value)) throw new Error(`${name}: record not found or deleted`);
  return recordSchemas[name].parse(value) as Records[K];
}
