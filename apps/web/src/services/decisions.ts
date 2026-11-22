import Dexie from "dexie";
import { decisionQuerySchema, decisionSchema } from "@perfect-draw/shared";
import type { DecisionService } from "@perfect-draw/shared";
import { db, live } from "../data/db";

export const decisionService: DecisionService = {
  /** Called in the same transaction as round state and financial changes. */
  async record(input: unknown) {
    const decision = decisionSchema.parse(input);
    const transaction = Dexie.currentTransaction;
    if (!transaction || transaction.mode !== "readwrite" || !["decisions", "sessions"].every(name => transaction.storeNames.includes(name))) {
      throw new Error("Record a decision in the same transaction as its session state.");
    }
    await db.records("decisions").add(decision);
    return decision;
  },
  async query(input = {}) {
    const filters = decisionQuerySchema.parse(input);
    const rows = filters.sessionId
      ? await db.records("decisions").where("sessionId").equals(filters.sessionId).toArray()
      : await db.records("decisions").toArray();
    return rows.filter(row => live(row) && (!filters.paytableId || row.paytableId === filters.paytableId) &&
      (filters.since === undefined || row.createdAt >= filters.since) &&
      (filters.includeCorrections || !row.isCorrection)).map(row => decisionSchema.parse(row)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  },
};
