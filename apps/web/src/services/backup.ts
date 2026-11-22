import { z } from "zod";
import { profileSchema, recordSchemas } from "@perfect-draw/shared";
import type { TableName } from "@perfect-draw/shared";
import { payTableId } from "@perfect-draw/paytables";
import { getGameFamily } from "@perfect-draw/engine";
import type { PayTable } from "@perfect-draw/engine";
import { db } from "../data/db";
import { creditState } from "./money";
import { countDecisions } from "./retention";

export const backupTables = (Object.keys(recordSchemas) as TableName[]).filter(x => x !== "aiKeys" && x !== "analyses");
const envelopeSchema = z.object({
  format: z.literal("perfect-draw-backup"), version: z.literal(1),
  exportedAt: z.number().int().nonnegative(), tables: z.record(z.array(z.unknown())),
}).strict();
function validateRelations(tables: Record<string, Record<string, unknown>[]>) {
  const has = (table: string, id: unknown) => tables[table].some(row => row.id === id);
  const require = (table: string, id: unknown) => { if (!has(table, id)) throw new Error(`Backup references a missing ${table} record.`); };
  const requireLive = (table: string, id: unknown) => {
    if (!tables[table].some(row => row.id === id && row.deletedAt == null)) throw new Error(`Backup references a deleted ${table} record.`);
  };
  for (const row of tables.paytables) {
    const table = row as unknown as PayTable;
    const ranks = getGameFamily(table.familyId).handRanks;
    if (ranks.some(rank => !table.pays[rank]) || payTableId(table) !== table.id) throw new Error("Backup has an invalid pay table or content hash.");
  }
  for (const row of [...tables.machines, ...tables.sessions]) {
    if ((row.variant as { kind: string }).kind !== "standard") throw new Error("This backup contains unsupported multiplier games.");
  }
  for (const row of tables.machines.filter(row => row.deletedAt == null)) {
    requireLive("wallets", row.defaultWalletId); requireLive("paytables", row.paytableId);
  }
  for (const row of tables.sessions.filter(row => row.deletedAt == null && row.status !== "closed")) {
    requireLive("machines", row.machineId); requireLive("wallets", row.walletId);
    requireLive("paytables", (row.machineSnapshot as { paytableId: string }).paytableId);
  }
  for (const row of tables.machines) { require("wallets", row.defaultWalletId); require("paytables", row.paytableId); }
  for (const row of tables.sessions) {
    require("machines", row.machineId); require("wallets", row.walletId);
    require("paytables", (row.machineSnapshot as { paytableId: string }).paytableId);
  }
  for (const row of tables.walletLedger) { require("wallets", row.walletId); if (row.sessionId) require("sessions", row.sessionId); }
  for (const row of tables.decisions) { require("sessions", row.sessionId); require("paytables", row.paytableId); }
  for (const table of ["heuristicCards", "scoutingLog", "dailyAggregates"]) for (const row of tables[table]) require("paytables", row.paytableId);
  for (const row of tables.trips) require("rewardsPrograms", row.programId);
  for (const row of tables.casinoSessions) {
    require("trips", row.tripId);
    if (row.machineId) require("machines", row.machineId);
    if (row.paytableId) require("paytables", row.paytableId);
  }
  for (const row of tables.rewardsReceived) {
    require("rewardsPrograms", row.programId);
    if (row.tripId) require("trips", row.tripId);
  }
  // Wallet balances are materialized ledger totals, never independent editable values.
  for (const wallet of tables.wallets) {
    const rows = tables.walletLedger.filter(row => row.walletId === wallet.id).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let balance = 0;
    for (const row of rows) {
      if (row.deletedAt != null) throw new Error("A backup cannot delete financial ledger entries.");
      balance += row.amountCents as number;
      if (!Number.isSafeInteger(balance) || balance < 0 || balance !== row.balanceAfterCents) throw new Error("Backup wallet ledger is inconsistent.");
    }
    if (balance !== wallet.balanceCents) throw new Error("Backup wallet balance does not match its ledger.");
  }
  const transfers = new Map<string, Record<string, unknown>[]>();
  for (const row of tables.walletLedger.filter(row => row.type === "transfer")) {
    if (typeof row.transferId !== "string") throw new Error("A transfer is missing its matching entry.");
    transfers.set(row.transferId, [...transfers.get(row.transferId) ?? [], row]);
  }
  for (const pair of transfers.values()) if (pair.length !== 2 || pair[0].walletId === pair[1].walletId ||
    (pair[0].amountCents as number) + (pair[1].amountCents as number) !== 0) throw new Error("Backup transfer entries are not balanced.");
}
async function encodeBlob(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { encoding: "base64", mime: blob.type, data: btoa(binary) };
}
function decodeUpload(value: unknown): unknown {
  const row = z.record(z.unknown()).parse(value);
  if (!row.imageBlob) return row;
  const encoded = z.object({ encoding: z.literal("base64"), mime: z.string().max(100), data: z.string().max(40_000_000) }).strict().parse(row.imageBlob);
  const binary = atob(encoded.data);
  return { ...row, imageBlob: new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: encoded.mime }) };
}
export const backupService = {
  async export() {
    // Capture a consistent point-in-time snapshot, including both halves of transfers.
    const tables = await db.transaction("r", db.tables, async () => {
      const result: Record<string, unknown[]> = {};
      for (const name of backupTables) result[name] = (await db.table(name).toArray()).map(row => recordSchemas[name].parse(row));
      return result;
    });
    for (const raw of tables.uploads as { imageBlob?: Blob }[]) if (raw.imageBlob) {
      (raw as unknown as { imageBlob: unknown }).imageBlob = await encodeBlob(raw.imageBlob);
    }
    // Settings may be restored, but a backup never contains or opts into remembered keys.
    tables.aiSettings = tables.aiSettings.map(row => ({ ...row as object, rememberKeys: false }));
    const archivedCount = (tables.dailyAggregates as { n: number; excludedCorrections: number }[]).reduce((sum, row) => sum + row.n + row.excludedCorrections, 0);
    const snapshotCount = tables.decisions.length + archivedCount;
    tables.profile = tables.profile.map(row => {
      const profile = profileSchema.parse(row);
      return { ...profile, prefs: { ...profile.prefs, lastBackupAt: Date.now(), lastBackupDecisionCount: snapshotCount } };
    });
    const result = JSON.stringify({ format: "perfect-draw-backup", version: 1, exportedAt: Date.now(), tables });
    await this.markExported(snapshotCount);
    return result;
  },
  async markExported(snapshotCount?: number) {
    await db.transaction("rw", [db.records("profile"), db.records("decisions"), db.records("dailyAggregates")], async () => {
      const profile = profileSchema.parse(await db.records("profile").get("local"));
      const count = snapshotCount ?? await countDecisions();
      await db.records("profile").put({ ...profile, updatedAt: Date.now(), prefs: { ...profile.prefs, lastBackupAt: Date.now(), lastBackupDecisionCount: count } });
    });
  },
  /** Replace-only restore; UI must get explicit confirmation before calling. */
  async import(text: string) {
    if (text.length > 100_000_000) throw new Error("Backup exceeds the 100 MB import limit.");
    const envelope = envelopeSchema.parse(JSON.parse(text));
    if (Object.keys(envelope.tables).length !== backupTables.length || backupTables.some(name => !envelope.tables[name])) {
      throw new Error("Backup is incomplete or uses an unsupported table set.");
    }
    const parsed: Record<string, Record<string, unknown>[]> = {};
    for (const name of backupTables) {
      parsed[name] = envelope.tables[name].map(row => recordSchemas[name].parse(name === "uploads" ? decodeUpload(row) : row));
      const keys = parsed[name].map(row => row.id);
      if (new Set(keys).size !== keys.length) throw new Error(`Backup has duplicate ${name} records.`);
    }
    if (new Set(parsed.dailyAggregates.map(row => row.bucketKey)).size !== parsed.dailyAggregates.length) throw new Error("Backup has duplicate aggregate buckets.");
    if (parsed.profile.length !== 1 || parsed.aiSettings.length !== 1) throw new Error("Backup is missing local settings.");
    validateRelations(parsed);
    // Recompute all open credits from their wallet rather than trusting stale display values.
    for (const session of parsed.sessions) {
      const wallet = parsed.wallets.find(row => row.id === session.walletId);
      const snapshot = session.machineSnapshot as { denominationCents: number };
      const state = session.state as { credits: number; creditRemainderCents: number };
      const cents = session.status !== "closed" && session.deletedAt == null ? wallet!.balanceCents as number
        : Math.round(state.credits * snapshot.denominationCents) + state.creditRemainderCents;
      session.state = { ...state, ...creditState(cents, snapshot.denominationCents) };
    }
    const profile = profileSchema.parse(parsed.profile[0]);
    if (!parsed.sessions.some(row => row.id === profile.prefs.activeSessionId && row.status !== "closed" && row.deletedAt == null)) profile.prefs.activeSessionId = null;
    parsed.profile = [profile];
    parsed.aiSettings = parsed.aiSettings.map(row => ({ ...row, rememberKeys: false }));
    await db.transaction("rw", db.tables, async () => {
      for (const table of db.tables) await table.clear();
      for (const name of backupTables) if (parsed[name].length) await db.table(name).bulkAdd(parsed[name]);
    });
    return { records: Object.values(parsed).reduce((count, rows) => count + rows.length, 0) };
  },
};
