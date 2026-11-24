import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, initializeDatabase } from "../src/data/db";
import { paytableService } from "../src/services/paytables";
import { machineService } from "../src/services/machines";
import { walletService } from "../src/services/wallets";
import { backupService } from "../src/services/backup";
import { draftFromLibrary, quickFill } from "../src/paytables/model";
import type { DraftTable } from "../src/paytables/model";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
});
const draft = (shorthand: string): DraftTable => {
  const result = quickFill(draftFromLibrary("jacks_or_better"), shorthand);
  if ("error" in result) throw new Error(result.error);
  return result.draft;
};
const computed = { returnPct: 96.15, hitFreq: 0.45, variance: 19.4, engineVersion: "test" };

describe("custom pay tables", () => {
  it("uses the built-in table when the pays match it", async () => {
    const result = await paytableService.saveCustom({ name: "My 9/6", draft: draft("9/6") });
    expect(result).toMatchObject({ matched: "library", name: "9/6 Jacks or Better" });
    expect(await paytableService.listCustom()).toEqual([]);
  });
  it("saves new pays once, recognises them again, renames them, and survives a backup round trip", async () => {
    const first = await paytableService.saveCustom({ name: "7/5 Jacks", draft: draft("7/5"), computed });
    expect(first.matched).toBeNull();
    const again = await paytableService.saveCustom({ name: "Another name", draft: draft("7/5") });
    expect(again).toMatchObject({ id: first.id, matched: "custom", name: "7/5 Jacks" });
    await paytableService.rename(first.id, "Ship 7/5");
    const [saved] = await paytableService.listCustom();
    expect(saved).toMatchObject({ id: first.id, name: "Ship 7/5", source: "manual", computed });
    expect(saved.pays.NOTHING).toEqual([0, 0, 0, 0, 0]);
    const backup = await backupService.export();
    await backupService.import(backup);
    expect((await paytableService.listCustom()).map(row => row.name)).toEqual(["Ship 7/5"]);
  });
  it("refuses to delete a table a machine uses, then deletes it once unused", async () => {
    const { id } = await paytableService.saveCustom({ name: "7/5 Jacks", draft: draft("7/5") });
    const wallet = await walletService.create({ name: "Bankroll", initialCents: 1000 });
    const machine = await machineService.save({ name: "Seven Five", paytableId: id, denominationCents: 25, defaultWalletId: wallet.id });
    await expect(paytableService.remove(id)).rejects.toThrow("“Seven Five” uses this pay table");
    await machineService.remove(machine.id);
    await paytableService.remove(id);
    expect(await paytableService.listCustom()).toEqual([]);
    await expect(paytableService.remove("0".repeat(64))).rejects.toThrow("Only your own pay tables");
  });
});
