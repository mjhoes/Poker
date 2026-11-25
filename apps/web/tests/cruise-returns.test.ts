import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newId } from "@perfect-draw/shared";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { db, initializeDatabase } from "../src/data/db";

const report = vi.fn();
vi.mock("../src/services/statistics", () => ({ statsService: { report: (...args: unknown[]) => report(...args) } }));
vi.mock("../src/worker/client", () => ({ engineClient: () => ({ tableSummary: async () => ({ returnPct: 99.54 }) }) }));
const { expectedReturn, practiceOn } = await import("../src/cruise/useCruise");

const table = PAY_TABLE_LIBRARY[0].id;
async function practice(count: number, extra: Record<string, unknown> = {}) {
  await db.table("decisions").bulkAdd(Array.from({ length: count }, (_, index) => ({
    id: newId(), paytableId: table, coins: 5, isCorrection: false, deletedAt: null, updatedAt: 1000 + index, createdAt: 1000 + index, ...extra,
  })));
}
const stats = (over: Record<string, unknown>) => ({ realPlayWeightedReturnPct: null, realPlayWeightedEstimatePct: null, asDrilledReturnPct: 97, frequencyCoverage: 0.4, imputedFrequencyShare: 0.6, ...over });

beforeEach(async () => {
  report.mockReset();
  await db.transaction("rw", db.tables, async () => { for (const item of db.tables) await item.clear(); });
  await initializeDatabase();
});

describe("expected return for real play (PR #7 review)", () => {
  it("never turns a drill-weighted figure into a measured one: too little coverage stays optimal, saying why", async () => {
    await practice(250);
    report.mockResolvedValue(stats({}));
    expect(await expectedReturn(table, 5)).toEqual({ optimalPct: 99.54, effectivePct: 99.54, basis: "optimal", reason: "low-coverage", coverage: 0.4 });
  });
  it("labels a 99%-coverage figure as an estimate with its imputed share, and uses a full-coverage one as measured", async () => {
    await practice(250);
    report.mockResolvedValue(stats({ realPlayWeightedEstimatePct: 99.3, frequencyCoverage: 0.995, imputedFrequencyShare: 0.005 }));
    expect(await expectedReturn(table, 5)).toMatchObject({ effectivePct: 99.3, basis: "estimated", imputedShare: 0.005 });
    await practice(1);
    report.mockResolvedValue(stats({ realPlayWeightedReturnPct: 99.2, frequencyCoverage: 1, imputedFrequencyShare: 0 }));
    expect(await expectedReturn(table, 5)).toMatchObject({ effectivePct: 99.2, basis: "measured" });
  });
  it("is worked out again when practice changes: crossing 200 decisions, more mistakes, or deleted history", async () => {
    await practice(199);
    expect(await expectedReturn(table, 5)).toMatchObject({ basis: "optimal", reason: "few-decisions" });
    expect(report).not.toHaveBeenCalled();
    await practice(1);
    report.mockResolvedValue(stats({ realPlayWeightedReturnPct: 99.4 }));
    expect(await expectedReturn(table, 5)).toMatchObject({ effectivePct: 99.4, basis: "measured" });
    await practice(5);
    report.mockResolvedValue(stats({ realPlayWeightedReturnPct: 99.1 }));
    expect(await expectedReturn(table, 5)).toMatchObject({ effectivePct: 99.1 });
    // Deleting history (soft delete) changes the version too.
    const before = (await practiceOn(table, 5)).version;
    const row = (await db.table("decisions").toArray())[0];
    await db.table("decisions").put({ ...row, deletedAt: 5000, updatedAt: 5000 });
    expect((await practiceOn(table, 5)).version).not.toBe(before);
    // Unchanged practice is answered from the cache.
    const calls = report.mock.calls.length;
    await expectedReturn(table, 5); await expectedReturn(table, 5);
    expect(report.mock.calls.length).toBe(calls + 1);
  });
  it("counts only practice at the same bet", async () => {
    await practice(300, { coins: 1 });
    expect(await expectedReturn(table, 5)).toMatchObject({ basis: "optimal", reason: "few-decisions" });
  });
});
