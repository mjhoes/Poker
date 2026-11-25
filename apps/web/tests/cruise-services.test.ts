import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, initializeDatabase } from "../src/data/db";
import { casinoService, programService, rewardService, tripService } from "../src/services/cruise";
import { backupService } from "../src/services/backup";
import { estimateFor, pointsEarned, rollup, sessionCoinIn } from "../src/cruise/economics";

let clock = new Date("2026-12-01T20:00:00").getTime();
beforeEach(async () => {
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
});
afterEach(() => { vi.restoreAllMocks(); });
const advance = (minutes: number) => { clock += minutes * 60_000; };

async function trip() {
  const [program] = await programService.list();
  return { program, trip: await tripService.save({ programId: program.id, shipName: "Wonder", sailStart: "2026-12-01", sailEnd: "2026-12-04", targetPoints: 2500 }) };
}

describe("rewards programs", () => {
  it("seeds Club Royale once: $15 a point, carryover, free play earns nothing; all editable", async () => {
    await Promise.all([initializeDatabase(), initializeDatabase()]);
    const programs = await programService.list();
    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({ name: "Royal Caribbean Club Royale", dollarsPerPoint: 15, rounding: "carryover", freePlayEarnsPoints: false, isBuiltIn: true });
    const edited = await programService.save({ ...programs[0], dollarsPerPoint: 10 }, programs[0].id);
    expect(edited.dollarsPerPoint).toBe(10);
    expect(edited.isBuiltIn).toBe(true);
    await expect(programService.save({ ...programs[0], tiers: [{ name: "B", points: 10 }, { name: "A", points: 5 }] }, programs[0].id)).rejects.toThrow("lowest to highest");
  });
});

describe("trips", () => {
  it("make a day per date, keep planned days when the dates change, and delete with their sessions and rewards", async () => {
    const { program, trip: saved } = await trip();
    expect(saved.days.map(day => day.date)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
    const port = saved.days.map(day => day.date === "2026-12-02" ? { ...day, type: "port" as const, casinoHoursPlanned: 1 } : day);
    await tripService.save({ ...saved, days: port }, saved.id);
    const longer = await tripService.save({ ...saved, days: undefined, sailEnd: "2026-12-05" }, saved.id);
    expect(longer.days).toHaveLength(5);
    expect(longer.days[1]).toEqual({ date: "2026-12-02", type: "port", casinoHoursPlanned: 1 });
    await expect(tripService.save({ ...saved, sailEnd: "2026-11-30" })).rejects.toThrow("end on or after");

    const session = await casinoService.start({ tripId: saved.id, denominationCents: 25, coins: 5 });
    await rewardService.add({ programId: program.id, tripId: saved.id, description: "Free balcony cruise", type: "cruise", valueCents: 150_000, receivedAt: clock });
    await expect(tripService.remove(saved.id)).rejects.toThrow("Cash out");
    await casinoService.close(session.id, { cashOutCents: 0 });
    await tripService.remove(saved.id);
    expect(await tripService.list()).toEqual([]);
    expect(await casinoService.list()).toEqual([]);
    expect(await rewardService.list()).toEqual([]);
  });
});

describe("live casino session", () => {
  it("times play from timestamps, excluding pauses, and survives a reload (it is all in the database)", async () => {
    const { trip: saved } = await trip();
    const session = await casinoService.start({ tripId: saved.id, gameName: "9/6 Jacks", denominationCents: 25, coins: 5, cashInCents: 30_000, pointsBefore: 1000 });
    await expect(casinoService.start({ tripId: saved.id, denominationCents: 25, coins: 5 })).rejects.toThrow("already running");
    advance(30);
    await casinoService.pause(session.id, "hand_pay", 125_000);
    await expect(casinoService.pause(session.id, "drink")).rejects.toThrow("already paused");
    advance(20); // waiting for the hand pay: not play time
    await casinoService.resume(session.id);
    advance(30);
    await casinoService.addCash(session.id, 10_000);
    await casinoService.pointsNow(session.id, 1080);
    await expect(casinoService.pointsNow(session.id, 900)).rejects.toThrow("can't be lower");
    advance(10);

    const reloaded = (await casinoService.live())!;
    expect(reloaded.jackpots).toEqual([{ amountCents: 125_000, at: expect.any(Number) }]);
    expect(reloaded.timeSegments).toHaveLength(2);
    expect(reloaded.timeSegments[0].pauseReason).toBe("hand_pay");

    const closed = await casinoService.close(session.id, { pointsAfter: 1100, cashOutCents: 155_000, freePlayUsedCents: 2000 });
    expect(closed.activeMs).toBe(70 * 60_000);
    expect(closed.coinInSource).toBe("points");
    expect(await casinoService.live()).toBeUndefined();
    await expect(casinoService.addCash(session.id, 100)).rejects.toThrow("already been cashed out");

    const [program] = await programService.list();
    expect(sessionCoinIn(closed, program)).toEqual({ cents: 150_000, source: "points", withinCents: 1500 });
    const total = rollup([closed], program, pointsEarned([closed], program), () => ({ optimalPct: 99.54, effectivePct: 99.54, basis: "optimal" as const }));
    expect(total).toMatchObject({ points: 100, netCents: 115_000, hands: 1216 }); // ($1,500 + $20 free play) ÷ $1.25
    expect(total.unmeasuredSessions).toBe(1);
  });
  it("estimates coin-in from time × pace × bet; free play comes off on read, per the program's rule", async () => {
    const { program, trip: saved } = await trip();
    // Replit's PR #7 case: an hour at 600 hands/hr, $1.25 a hand, $100 of free play.
    const session = await casinoService.start({ tripId: saved.id, denominationCents: 25, coins: 5, cashInCents: 20_000 });
    advance(60);
    const closed = await casinoService.close(session.id, { cashOutCents: 15_000, freePlayUsedCents: 10_000, estimateHandsPerHour: 600 });
    expect(closed.coinInSource).toBe("estimate");
    expect(closed.coinInCents).toBe(75_000); // all play is stored
    expect(sessionCoinIn(closed, program).cents).toBe(65_000); // free play earns nothing
    expect(sessionCoinIn(closed, { ...program, freePlayEarnsPoints: true }).cents).toBe(75_000);
    const edited = await casinoService.edit(session.id, { cashInCents: 20_000, cashOutCents: 15_000, freePlayUsedCents: 0, handsCount: 300, notes: "" });
    expect(edited.coinInSource).toBe("hands");
  });
  it("works out an estimate when a correction removes a session's point readings, instead of keeping a zero", async () => {
    const { program, trip: saved } = await trip();
    const session = await casinoService.start({ tripId: saved.id, denominationCents: 25, coins: 5, cashInCents: 20_000, pointsBefore: 100 });
    advance(12); // 12 minutes at 600 hands/hr = 120 hands × $1.25 = $150
    const closed = await casinoService.close(session.id, { pointsAfter: 110, cashOutCents: 15_000 });
    expect([closed.coinInSource, closed.coinInCents]).toEqual(["points", 0]);
    const edited = await casinoService.edit(session.id, { cashInCents: 20_000, cashOutCents: 15_000, freePlayUsedCents: 0, notes: "", estimateHandsPerHour: 600 });
    expect(edited.coinInSource).toBe("estimate");
    expect(sessionCoinIn(edited, program).cents).toBe(15_000);
    // The same preview figure the correction dialog shows, and an existing estimate is kept on later corrections.
    expect(estimateFor(closed, closed.activeMs, 600)).toBe(15_000);
    const again = await casinoService.edit(session.id, { cashInCents: 20_000, cashOutCents: 14_000, freePlayUsedCents: 0, notes: "", estimateHandsPerHour: 900 });
    expect(again.coinInCents).toBe(15_000);
  });
});

it("backs up and restores the cruise records", async () => {
  const { program, trip: saved } = await trip();
  const session = await casinoService.start({ tripId: saved.id, denominationCents: 25, coins: 5, pointsBefore: 10 });
  advance(5);
  await casinoService.close(session.id, { pointsAfter: 20, cashOutCents: 0 });
  await rewardService.add({ programId: program.id, description: "Free play", type: "freeplay", valueCents: 10_000, receivedAt: clock });
  const text = await backupService.export();
  await tripService.remove(saved.id);
  await backupService.import(text);
  expect(await tripService.list()).toHaveLength(1);
  expect((await casinoService.list())[0]).toMatchObject({ pointsBefore: 10, pointsAfter: 20 });
  expect(await rewardService.list()).toHaveLength(1);
});
