import Dexie from "dexie";
import type { Table } from "dexie";
import { aiSettingsSchema, paytableSchema, profileSchema, recordSchemas } from "@perfect-draw/shared";
import type { Records, TableName } from "@perfect-draw/shared";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";

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
  }
  records<K extends TableName>(name: K): Table<Records[K], string> { return this.table(name); }
}
export const db = new LocalDatabase();
export const live = <T extends { deletedAt?: number | null }>(row: T) => row.deletedAt == null;
export function stamp() { return { updatedAt: Date.now(), deletedAt: null }; }

export async function initializeDatabase(database = db) {
  await database.transaction("rw", database.tables, async () => {
    const now = Date.now();
    if (!await database.records("profile").get("local")) {
      await database.records("profile").add(profileSchema.parse({ id: "local", createdAt: now, updatedAt: now }));
    }
    if (!await database.records("aiSettings").get("local")) {
      await database.records("aiSettings").add(aiSettingsSchema.parse({ id: "local", updatedAt: now }));
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
