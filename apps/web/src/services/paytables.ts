import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { nameSchema, paytableSchema } from "@perfect-draw/shared";
import type { GameSummary, Paytable } from "@perfect-draw/shared";
import { db, live, stamp } from "../data/db";
import { finalize } from "../paytables/model";
import type { DraftTable } from "../paytables/model";

export type SaveResult = { id: string; name: string; matched: "library" | "custom" | null };

/**
 * Custom (hand-entered) pay tables. A table's id is the hash of its pays, so entering a table that already exists —
 * built in or saved earlier — returns that table instead of creating a duplicate.
 */
export const paytableService = {
  async listCustom(): Promise<Paytable[]> {
    return (await db.records("paytables").toArray()).filter(row => row.source !== "library" && live(row)).map(row => paytableSchema.parse(row))
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async saveCustom(input: { name: string; draft: DraftTable; computed?: Paytable["computed"] }): Promise<SaveResult> {
    const { id, familyId, pays } = finalize(input.draft);
    const library = PAY_TABLE_LIBRARY.find(table => table.id === id);
    if (library) return { id, name: library.name, matched: "library" };
    const name = nameSchema.parse(input.name.trim());
    return db.transaction("rw", db.records("paytables"), async () => {
      const existing = await db.records("paytables").get(id);
      if (existing && live(existing)) return { id, name: existing.name, matched: "custom" as const };
      await db.records("paytables").put(paytableSchema.parse({
        id, familyId, pays, name, source: "manual", createdAt: existing?.createdAt ?? Date.now(), ...stamp(),
        computed: input.computed ?? existing?.computed,
      }));
      return { id, name, matched: null };
    });
  },

  async rename(id: string, name: string) {
    const parsed = nameSchema.parse(name.trim());
    await db.transaction("rw", db.records("paytables"), async () => {
      const row = await db.records("paytables").get(id);
      if (!row || !live(row) || row.source === "library") throw new Error("Only your own pay tables can be renamed.");
      await db.records("paytables").put(paytableSchema.parse({ ...row, name: parsed, updatedAt: Date.now() }));
    });
  },

  /**
   * Saves a table's figures at one bet (computed seconds earlier). It writes onto the record as it is now, so a rename,
   * delete or backup restore made meanwhile is kept; a table that is gone or deleted is left alone. Returns whether saved.
   */
  async saveSummary(id: string, coins: number, summary: GameSummary) {
    const key = String(coins) as "1" | "2" | "3" | "4" | "5";
    return db.transaction("rw", db.records("paytables"), async () => {
      const row = await db.records("paytables").get(id);
      if (!row || !live(row)) return false;
      await db.records("paytables").put(paytableSchema.parse({ ...row, summaries: { ...row.summaries, [key]: summary } }));
      return true;
    });
  },

  /** Removes a custom table that no machine or open session uses. Past sessions and statistics keep their copy. */
  async remove(id: string) {
    await db.transaction("rw", [db.records("paytables"), db.records("machines"), db.records("sessions")], async () => {
      const row = await db.records("paytables").get(id);
      if (!row || !live(row) || row.source === "library") throw new Error("Only your own pay tables can be deleted.");
      const machines = (await db.records("machines").toArray()).filter(machine => live(machine) && machine.paytableId === id);
      if (machines.length) throw new Error(`${machines.length === 1 ? `“${machines[0].name}” uses` : `${machines.length} machines use`} this pay table. Change or delete ${machines.length === 1 ? "it" : "them"} first.`);
      const open = (await db.records("sessions").toArray()).filter(session => session.status !== "closed" && session.machineSnapshot.paytableId === id);
      if (open.length) throw new Error("An open session uses this pay table. Close it first.");
      await db.records("paytables").put(paytableSchema.parse({ ...row, updatedAt: Date.now(), deletedAt: Date.now() }));
    });
  },
};
