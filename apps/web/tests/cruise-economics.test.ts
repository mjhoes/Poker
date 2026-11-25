import { describe, expect, it } from "vitest";
import {
  activeMs, costPerPointCents, hoursLeft, plan, pointsEarned, practicePace, rewardsSummary, rollup, sessionCoinIn,
  sessionStatus, toCsv, tripDays, tripPhase,
} from "../src/cruise/economics";
import type { CasinoSession, Program, Reward } from "../src/cruise/economics";

const program = (over: Partial<Program> = {}): Program => ({
  id: "p", updatedAt: 0, deletedAt: null, createdAt: 0, name: "Club Royale", casinoName: "Casino Royale", dollarsPerPoint: 15,
  rounding: "carryover", freePlayEarnsPoints: false, tiers: [], notes: "", isBuiltIn: true, ...over,
});
let next = 0;
const session = (over: Partial<CasinoSession> = {}): CasinoSession => {
  const startedAt = over.startedAt ?? 1_000_000 + next * 10_000_000;
  return {
    id: `s${next++}`, updatedAt: 0, deletedAt: null, tripId: "t", gameName: "9/6 Jacks", denominationCents: 25, coins: 5, lines: 1,
    startedAt, endedAt: startedAt + 3_600_000, timeSegments: [{ start: startedAt, end: startedAt + 3_600_000 }], activeMs: 3_600_000,
    cashInCents: 0, cashOutCents: 0, freePlayUsedCents: 0, freePlayWonCents: 0, coinInCents: 0, coinInSource: "estimate",
    jackpots: [], notes: "", ...over,
  };
};

describe("coin-in", () => {
  it("comes from points (Δ × $15, within one point), else hands × bet less free play, else the stored estimate", () => {
    expect(sessionCoinIn(session({ pointsBefore: 100, pointsAfter: 140 }), program())).toEqual({ cents: 60_000, source: "points", withinCents: 1500 });
    // 400 hands × $1.25 = $500, less $20 of free play (which earns nothing).
    expect(sessionCoinIn(session({ handsCount: 400, freePlayUsedCents: 2000 }), program())).toEqual({ cents: 48_000, source: "hands", withinCents: 0 });
    expect(sessionCoinIn(session({ handsCount: 400, freePlayUsedCents: 2000 }), program({ freePlayEarnsPoints: true })).cents).toBe(50_000);
    expect(sessionCoinIn(session({ coinInCents: 12_345 }), program())).toEqual({ cents: 12_345, source: "estimate", withinCents: 0 });
    // Still playing: only a points reading gives coin-in.
    expect(sessionCoinIn(session({ endedAt: null, handsCount: 10 }), program()).source).toBe("none");
    expect(sessionCoinIn(session({ endedAt: null, pointsBefore: 5, pointsAfter: 9 }), program()).cents).toBe(6000);
  });
  it("follows the program's $ per point, so changing it recalculates history", () => {
    expect(sessionCoinIn(session({ pointsBefore: 0, pointsAfter: 10 }), program({ dollarsPerPoint: 10 })).cents).toBe(10_000);
  });
});

describe("points", () => {
  it("carry coin-in over between sessions: a point at each next full $15", () => {
    // $10 + $10 + $10 = $30 → 0, then 1 (at $15 total), then 1 more (at $30).
    const rows = [session({ handsCount: 8 }), session({ handsCount: 8 }), session({ handsCount: 8 })];
    expect([...pointsEarned(rows, program()).values()]).toEqual([0, 1, 1]);
    expect([...pointsEarned(rows, program({ rounding: "session_floor" })).values()]).toEqual([0, 0, 0]);
    expect([...pointsEarned(rows, program({ rounding: "fractional" })).values()].map(x => +x.toFixed(4))).toEqual([0.6667, 0.6667, 0.6667]);
  });
  it("use a points reading as the machine's own count, keeping the carried remainder", () => {
    const rows = [session({ handsCount: 8 }), session({ pointsBefore: 3, pointsAfter: 7 }), session({ handsCount: 4 })];
    // $10 carried; the reading says 4; then $5 more reaches $15 of carried remainder → 1.
    expect([...pointsEarned(rows, program()).values()]).toEqual([0, 4, 1]);
  });
  it("are counted in time order whatever order the sessions arrive in", () => {
    const a = session({ handsCount: 8 }), b = session({ handsCount: 8 });
    expect(pointsEarned([b, a], program()).get(b.id)).toBe(1);
  });
});

describe("timer", () => {
  it("adds up segments; the open one runs to now; status follows the last segment", () => {
    const live = session({ endedAt: null, timeSegments: [{ start: 0, end: 600_000, pauseReason: "drink" }, { start: 900_000 }] });
    expect(activeMs(live, 1_200_000)).toBe(900_000);
    expect(sessionStatus(live)).toBe("playing");
    expect(sessionStatus({ ...live, timeSegments: [{ start: 0, end: 600_000 }] })).toBe("paused");
    expect(sessionStatus(session())).toBe("closed");
  });
});

describe("rollup", () => {
  it("gives actual and theoretical cost per point, mistakes' share, and rates per hour", () => {
    const rows = [
      session({ pointsBefore: 0, pointsAfter: 100, cashInCents: 50_000, cashOutCents: 30_000 }), // $1,500 coin-in, −$200
      session({ pointsBefore: 100, pointsAfter: 200, cashInCents: 20_000, cashOutCents: 25_000 }), // +$50
    ];
    const prog = program();
    const total = rollup(rows, prog, pointsEarned(rows, prog), () => ({ optimalPct: 99.54, effectivePct: 99.19, measured: true }));
    expect(total.points).toBe(200);
    expect(total.coinInCents).toBe(300_000);
    expect(total.netCents).toBe(-15_000);
    expect(total.actualCostPerPointCents).toBe(75);
    expect(total.theoreticalCostCents).toBeCloseTo(300_000 * 0.0081, 6);
    expect(total.theoreticalCostPerPointCents).toBeCloseTo(15 * 100 * 0.0081, 6); // = $15 × (1 − return)
    expect(total.mistakeCostCents).toBeCloseTo(300_000 * 0.0035, 6);
    expect(total.pointsPerHour).toBe(100);
    expect(total.handsPerHour).toBe(1200); // $1,500 ÷ $1.25 per hand, per hour
    expect(total.coinInBySource.points).toBe(300_000);
  });
  it("leaves coin-in on games without a known return out of the theoretical cost per point", () => {
    const known = session({ pointsBefore: 0, pointsAfter: 100, paytableId: "a".repeat(64) });
    const other = session({ pointsBefore: 100, pointsAfter: 200, gameName: "Ultimate X" });
    const total = rollup([known, other], program(), pointsEarned([known, other], program()),
      row => row.paytableId ? { optimalPct: 99.54, effectivePct: 99.54, measured: true } : null);
    expect(total.coinInWithoutReturnCents).toBe(150_000);
    expect(total.theoreticalCostPerPointCents).toBeCloseTo(15 * 100 * 0.0046, 6);
    expect(rollup([other], program(), pointsEarned([other], program()), () => null).theoreticalCostPerPointCents).toBeNull();
  });
  it("gives no per-hour rates until 10 minutes have been played", () => {
    const quick = session({ pointsBefore: 0, pointsAfter: 100, timeSegments: [{ start: 0, end: 1000 }] });
    quick.endedAt = 1000;
    const total = rollup([quick], program(), pointsEarned([quick], program()), () => null, 1000);
    expect([total.pointsPerHour, total.handsPerHour, total.coinInPerHourCents]).toEqual([null, null, null]);
  });
  it("counts rewards against the loss", () => {
    const reward = { valueCents: 10_000 } as Reward;
    const summary = rewardsSummary([reward], { netCents: -15_000, points: 200 });
    expect(summary).toMatchObject({ valueCents: 10_000, netCostPerPointCents: 25, valuePerPointCents: 50 });
    expect(summary.roiPct).toBeCloseTo(-100 / 3, 9);
  });
});

describe("cost per point and planner (07-CRUISE-REWARDS.md §3–4)", () => {
  it("prices a point at $15 × (1 − return)", () => {
    expect(costPerPointCents(program(), 99.54)).toBeCloseTo(6.9, 9);
    expect(costPerPointCents(program(), 96)).toBeCloseTo(60, 9);
  });
  it("reproduces the worked example exactly: 2,500 points at $1.25 and $5 a hand, 700 hands an hour", () => {
    const base = { targetPoints: 2500, pointsSoFar: 0, dollarsPerPoint: 15, handsPerHour: 700, hoursLeft: 40, effectiveReturnPct: 99.54 };
    const quarters = plan({ ...base, betCents: 125 });
    expect(quarters.coinInNeededCents).toBe(3_750_000);
    expect(quarters.handsNeeded).toBe(30_000);
    expect(quarters.hoursNeeded).toBeCloseTo(42.857, 3);
    expect(Math.round(quarters.hoursNeeded)).toBe(43);
    expect(quarters.expectedCostCents).toBeCloseTo(17_250, 6); // ~$173
    expect(quarters.onTrack).toBe(false);
    expect(quarters.requiredHandsPerHour).toBe(750);
    expect(quarters.requiredBetCents).toBeCloseTo(3_750_000 / (700 * 40), 9);
    const dollars = plan({ ...base, betCents: 500 });
    expect(dollars.handsNeeded).toBe(7500);
    expect(Math.round(dollars.hoursNeeded)).toBe(11);
    expect(dollars.expectedCostCents).toBe(quarters.expectedCostCents); // same cost, less time
    expect(dollars.onTrack).toBe(true);
    expect(dollars.pointsPerHour).toBeCloseTo(700 * 5 / 15, 9);
  });
  it("needs nothing once the target is reached", () => {
    const done = plan({ targetPoints: 100, pointsSoFar: 120, dollarsPerPoint: 15, betCents: 125, handsPerHour: 700, hoursLeft: 0, effectiveReturnPct: 99 });
    expect([done.pointsNeeded, done.handsNeeded, done.onTrack, done.requiredHandsPerHour]).toEqual([0, 0, true, null]);
  });
});

describe("trip days and hours left", () => {
  it("makes one day per date, keeping days already set", () => {
    const days = tripDays("2026-12-30", "2027-01-02", [{ date: "2026-12-31", type: "port", casinoHoursPlanned: 2 }]);
    expect(days.map(day => `${day.date}:${day.type}:${day.casinoHoursPlanned}`)).toEqual(["2026-12-30:sea:6", "2026-12-31:port:2", "2027-01-01:sea:6", "2027-01-02:sea:6"]);
  });
  it("counts later days plus what's left of today after today's play", () => {
    const now = new Date("2026-12-31T20:00:00").getTime();
    const trip = { days: tripDays("2026-12-30", "2027-01-01") };
    const today = new Date("2026-12-31T18:00:00").getTime();
    const played = session({ startedAt: today, endedAt: today + 2 * 3_600_000, timeSegments: [{ start: today, end: today + 2 * 3_600_000 }] });
    expect(hoursLeft(trip, [played], now)).toBe(6 + 4);
    expect(tripPhase({ sailStart: "2026-12-30", sailEnd: "2027-01-01", status: "planned" }, now)).toBe("active");
    expect(tripPhase({ sailStart: "2027-01-05", sailEnd: "2027-01-09", status: "planned" }, now)).toBe("planned");
  });
});

describe("practice pace", () => {
  it("counts gaps up to a minute as play and longer ones as breaks", () => {
    const decisions = Array.from({ length: 31 }, (_, index) => ({
      sessionId: "a", createdAt: index * 5000 + (index > 15 ? 600_000 : 0), isCorrection: false, coins: 5, lines: 1, denominationCents: 25,
    }));
    const pace = practicePace(decisions);
    expect(pace.hands).toBe(31);
    expect(pace.activeMs).toBe(29 * 5000); // the 10-minute break is left out
    expect(pace.handsPerHour).toBeCloseTo(720, 9);
    expect(pace.coinInCents).toBe(31 * 125);
    expect(practicePace(decisions.slice(0, 5)).handsPerHour).toBeNull(); // too few to say
  });
});

it("writes CSV with quoting", () => {
  expect(toCsv([["a", 'say "hi"', null], [1, "x,y", undefined]])).toBe('a,"say ""hi""",\r\n1,"x,y",\r\n');
});
