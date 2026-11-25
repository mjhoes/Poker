import { z } from "zod";
import { casinoSessionSchema, newId, pauseReasons, rewardSchema, rewardsProgramSchema, tripDaySchema, tripSchema, uuid } from "@perfect-draw/shared";
import type { Records } from "@perfect-draw/shared";
import { db, live, requireRecord, stamp } from "../data/db";
import { activeMs, DEFAULT_HANDS_PER_HOUR, estimatedPlayCents, estimateFor, practicePace, sessionStatus, tripDays } from "../cruise/economics";
import type { CasinoSession, Program, Reward, Trip } from "../cruise/economics";

/*
 * Rewards programs, cruise trips, real casino sessions and rewards received. Everything is local; only readings are
 * stored (see cruise/economics.ts for what is derived from them). One casino session can be live at a time, and its
 * timer is a list of timestamped segments, so it survives reloads, closed tabs and a locked phone.
 */

const points = z.number().int().nonnegative().max(100_000_000);
const money = z.number().int().nonnegative().safe();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const programInputSchema = rewardsProgramSchema.pick({ name: true, casinoName: true, dollarsPerPoint: true, rounding: true, freePlayEarnsPoints: true, tiers: true, notes: true });
export const tripInputSchema = z.object({
  programId: uuid, shipName: z.string().trim().min(1, "Name the ship or trip.").max(100), sailStart: isoDate, sailEnd: isoDate,
  days: z.array(tripDaySchema).max(120).optional(), targetPoints: points, startingPoints: points.optional(), notes: z.string().max(2000).default(""),
  status: tripSchema.innerType().shape.status.optional(),
}).refine(trip => trip.sailStart <= trip.sailEnd, "The trip must end on or after the day it starts.")
  .refine(trip => tripDays(trip.sailStart, trip.sailEnd).length < 120, "A trip can be at most 119 days.");
export const casinoStartSchema = z.object({
  tripId: uuid, machineId: uuid.optional(), paytableId: casinoSessionSchema.shape.paytableId, familyId: casinoSessionSchema.shape.familyId,
  gameName: z.string().trim().max(200).default(""), denominationCents: casinoSessionSchema.shape.denominationCents,
  coins: casinoSessionSchema.shape.coins, lines: z.number().int().positive().max(100).default(1),
  cashInCents: money.default(0), pointsBefore: points.optional(),
});
export const casinoCloseSchema = z.object({
  pointsAfter: points.optional(), cashOutCents: money, freePlayUsedCents: money.default(0), handsCount: z.number().int().nonnegative().max(10_000_000).optional(),
  notes: z.string().max(2000).default(""),
  /** Pace for an estimate when there is neither a points reading nor a hand count. */
  estimateHandsPerHour: z.number().positive().max(5000).default(DEFAULT_HANDS_PER_HOUR),
});
export const casinoEditSchema = casinoCloseSchema.extend({
  cashInCents: money, pointsBefore: points.optional(), coinInCents: money.optional(),
});
export const rewardInputSchema = z.object({
  programId: uuid, tripId: uuid.optional(), description: z.string().trim().min(1, "Describe the reward.").max(200),
  type: rewardSchema.shape.type, valueCents: money, receivedAt: z.number().int().nonnegative(), notes: z.string().max(2000).default(""),
});

const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> => schema.parse(value);
const liveRows = async <K extends "rewardsPrograms" | "trips" | "casinoSessions" | "rewardsReceived">(name: K) =>
  (await db.records(name).toArray()).filter(live) as Records[K][];

export const programService = {
  async list(): Promise<Program[]> { return (await liveRows("rewardsPrograms")).sort((a, b) => Number(b.isBuiltIn) - Number(a.isBuiltIn) || a.createdAt - b.createdAt); },
  async save(input: z.input<typeof programInputSchema>, id?: string): Promise<Program> {
    const values = programInputSchema.parse(input);
    if (values.tiers.some((tier, index) => index > 0 && tier.points <= values.tiers[index - 1].points)) throw new Error("List tiers from lowest to highest points.");
    return db.transaction("rw", db.records("rewardsPrograms"), async () => {
      const existing = id ? await requireRecord("rewardsPrograms", id) : undefined;
      const row = parse(rewardsProgramSchema, { ...existing ?? { id: newId(), createdAt: Date.now(), isBuiltIn: false }, ...values, ...stamp() });
      await db.records("rewardsPrograms").put(row);
      return row;
    });
  },
};

export const tripService = {
  async list(): Promise<Trip[]> { return (await liveRows("trips")).sort((a, b) => b.sailStart.localeCompare(a.sailStart) || b.createdAt - a.createdAt); },
  async save(input: z.input<typeof tripInputSchema>, id?: string): Promise<Trip> {
    const values = tripInputSchema.parse(input);
    return db.transaction("rw", [db.records("trips"), db.records("rewardsPrograms")], async () => {
      await requireRecord("rewardsPrograms", values.programId);
      const existing = id ? await requireRecord("trips", id) : undefined;
      // Days follow the dates; a day already planned keeps its type and hours.
      const days = tripDays(values.sailStart, values.sailEnd, values.days ?? existing?.days);
      const row = parse(tripSchema, {
        ...existing ?? { id: newId(), createdAt: Date.now(), status: "planned" }, ...values, days,
        status: values.status ?? existing?.status ?? "planned", ...stamp(),
      });
      await db.records("trips").put(row);
      return row;
    });
  },
  /** Deletes a trip with its casino sessions and rewards. A live session must be cashed out first. */
  async remove(id: string) {
    await db.transaction("rw", [db.records("trips"), db.records("casinoSessions"), db.records("rewardsReceived")], async () => {
      const trip = await requireRecord("trips", id);
      const sessions = (await db.records("casinoSessions").where("tripId").equals(id).toArray()).filter(live);
      if (sessions.some(session => session.endedAt === null)) throw new Error("Cash out of the live session first.");
      const now = Date.now();
      for (const session of sessions) await db.records("casinoSessions").put({ ...session, updatedAt: now, deletedAt: now });
      for (const reward of (await db.records("rewardsReceived").where("tripId").equals(id).toArray()).filter(live)) {
        await db.records("rewardsReceived").put({ ...reward, updatedAt: now, deletedAt: now });
      }
      await db.records("trips").put({ ...trip, updatedAt: now, deletedAt: now });
    });
  },
};

const sessions = () => db.records("casinoSessions");
async function update(id: string, change: (session: CasinoSession) => Partial<CasinoSession>, requireLive = true) {
  return db.transaction("rw", sessions(), async () => {
    const session = await requireRecord("casinoSessions", id);
    if (requireLive && session.endedAt !== null) throw new Error("This casino session has already been cashed out.");
    const row = parse(casinoSessionSchema, { ...session, ...change(session), updatedAt: Date.now() });
    await sessions().put(row);
    return row;
  });
}

export const casinoService = {
  async list(): Promise<CasinoSession[]> { return (await liveRows("casinoSessions")).sort((a, b) => a.startedAt - b.startedAt); },
  async live(): Promise<CasinoSession | undefined> { return (await liveRows("casinoSessions")).find(session => session.endedAt === null); },
  async start(input: z.input<typeof casinoStartSchema>): Promise<CasinoSession> {
    const values = casinoStartSchema.parse(input);
    return db.transaction("rw", [sessions(), db.records("trips")], async () => {
      await requireRecord("trips", values.tripId);
      if ((await sessions().toArray()).some(session => live(session) && session.endedAt === null)) throw new Error("A casino session is already running. Cash out of it first.");
      const now = Date.now();
      const row = parse(casinoSessionSchema, {
        id: newId(), ...stamp(), ...values, startedAt: now, endedAt: null, timeSegments: [{ start: now }], activeMs: 0,
        cashOutCents: 0, freePlayUsedCents: 0, freePlayWonCents: 0, coinInCents: 0, coinInSource: "estimate", jackpots: [], notes: "",
      });
      await sessions().add(row);
      return row;
    });
  },
  /** Stops the clock. A hand pay can record its amount (W-2G hand pays interrupt play). */
  pause(id: string, reason: typeof pauseReasons[number], handPayCents?: number) {
    return update(id, session => {
      if (sessionStatus(session) !== "playing") throw new Error("The timer is already paused.");
      const now = Date.now();
      const segments = session.timeSegments.map((segment, index) => index === session.timeSegments.length - 1 ? { ...segment, end: now, pauseReason: reason } : segment);
      const jackpots = reason === "hand_pay" && handPayCents ? [...session.jackpots, { amountCents: money.parse(handPayCents), at: now }] : session.jackpots;
      return { timeSegments: segments, jackpots, activeMs: activeMs({ ...session, timeSegments: segments }, now) };
    });
  },
  resume(id: string) {
    return update(id, session => {
      if (sessionStatus(session) !== "paused") throw new Error("The timer is already running.");
      return { timeSegments: [...session.timeSegments, { start: Date.now() }] };
    });
  },
  addCash(id: string, cents: number) {
    const amount = money.positive().parse(cents);
    return update(id, session => ({ cashInCents: session.cashInCents + amount }));
  },
  /** The latest points reading from the machine, so progress shows while playing. */
  pointsNow(id: string, value: number) {
    const reading = points.parse(value);
    return update(id, session => {
      if (session.pointsBefore === undefined) throw new Error("Enter the points you started with first.");
      if (reading < session.pointsBefore) throw new Error(`Points can't be lower than the ${session.pointsBefore.toLocaleString()} you started with.`);
      return { pointsAfter: reading };
    });
  },
  setStartingPoints(id: string, value: number) {
    const reading = points.parse(value);
    return update(id, session => {
      if (session.pointsAfter !== undefined && session.pointsAfter < reading) throw new Error("Starting points can't be above the latest reading.");
      return { pointsBefore: reading };
    });
  },
  /** Cash out: stops the clock and records the final readings. Coin-in comes from points, else hands, else an estimate. */
  close(id: string, input: z.input<typeof casinoCloseSchema>) {
    const values = casinoCloseSchema.parse(input);
    return update(id, session => {
      const now = Date.now();
      const segments = session.timeSegments.map(segment => segment.end === undefined ? { ...segment, end: now } : segment);
      const closed = { ...session, timeSegments: segments, endedAt: now };
      const pointsAfter = values.pointsAfter ?? session.pointsAfter;
      if (pointsAfter !== undefined && session.pointsBefore !== undefined && pointsAfter < session.pointsBefore) {
        throw new Error(`Points can't be lower than the ${session.pointsBefore.toLocaleString()} you started with.`);
      }
      const played = activeMs(closed, now);
      const source = pointsAfter !== undefined && session.pointsBefore !== undefined ? "points" : values.handsCount !== undefined ? "hands" : "estimate";
      // The estimate: active hours × pace × bet, all play. Free play is taken off on read, per the program's rule.
      const estimate = estimatedPlayCents(session, played, values.estimateHandsPerHour);
      return {
        timeSegments: segments, endedAt: now, activeMs: played, pointsAfter, cashOutCents: values.cashOutCents,
        freePlayUsedCents: values.freePlayUsedCents, handsCount: values.handsCount, notes: values.notes,
        coinInSource: source, coinInCents: source === "estimate" ? estimate : 0,
      };
    });
  },
  /** Corrects a closed session's readings. */
  edit(id: string, input: z.input<typeof casinoEditSchema>) {
    const values = casinoEditSchema.parse(input);
    return update(id, session => {
      if (session.endedAt === null) throw new Error("Cash out of this session before editing it.");
      if (values.pointsAfter !== undefined && values.pointsBefore !== undefined && values.pointsAfter < values.pointsBefore) throw new Error("Points after can't be lower than points before.");
      if ((values.pointsAfter === undefined) !== (values.pointsBefore === undefined) && values.handsCount === undefined && values.coinInCents === undefined) {
        throw new Error("Enter both point readings, or the hands played.");
      }
      const source = values.pointsAfter !== undefined && values.pointsBefore !== undefined ? "points" : values.handsCount !== undefined ? "hands" : "estimate";
      // Becoming an estimate (e.g. both point readings removed): work one out from the time played, never keep the
      // zero a points- or hands-based session stores. An existing estimate is kept unless a new figure is given.
      const { estimateHandsPerHour, coinInCents, ...readings } = values;
      const estimate = coinInCents ?? estimateFor(session, session.activeMs, estimateHandsPerHour);
      return { ...readings, coinInSource: source, coinInCents: source === "estimate" ? estimate : 0 };
    }, false);
  },
  async remove(id: string) {
    await db.transaction("rw", sessions(), async () => {
      const session = await requireRecord("casinoSessions", id);
      const now = Date.now();
      await sessions().put({ ...session, updatedAt: now, deletedAt: now });
    });
  },
};

export const rewardService = {
  async list(): Promise<Reward[]> { return (await liveRows("rewardsReceived")).sort((a, b) => b.receivedAt - a.receivedAt); },
  async add(input: z.input<typeof rewardInputSchema>): Promise<Reward> {
    const values = rewardInputSchema.parse(input);
    return db.transaction("rw", [db.records("rewardsReceived"), db.records("rewardsPrograms"), db.records("trips")], async () => {
      await requireRecord("rewardsPrograms", values.programId);
      if (values.tripId) await requireRecord("trips", values.tripId);
      const row = parse(rewardSchema, { id: newId(), ...stamp(), ...values });
      await db.records("rewardsReceived").add(row);
      return row;
    });
  },
  async remove(id: string) {
    await db.transaction("rw", db.records("rewardsReceived"), async () => {
      const reward = await requireRecord("rewardsReceived", id);
      const now = Date.now();
      await db.records("rewardsReceived").put({ ...reward, updatedAt: now, deletedAt: now });
    });
  },
};

/** Pace of your recent Free Play (hands per active hour), from the last 3,000 decisions. */
export async function practicePaceNow() {
  const freePlay = new Set((await db.records("sessions").toArray()).filter(session => live(session) && session.mode === "free_play").map(session => session.id));
  const decisions = (await db.records("decisions").orderBy("createdAt").reverse().limit(3000).toArray()).filter(decision => live(decision) && freePlay.has(decision.sessionId));
  return practicePace(decisions);
}
