import { z } from "zod";
import { entity, timestamp, nameSchema, uuid, hash, cents, positiveCents, familyIdSchema } from "./records";
import { sessionSchema } from "./records";
import { localDay } from "@perfect-draw/engine";

/**
 * A review card: one hold category of a game family. alpha/beta = Beta(1,1) counts (1 + right, 1 + wrong);
 * fsrs* and dueAt = spaced-repetition schedule (FSRS); reps/lapses count scheduled reviews and forgotten ones.
 */
export const masterySchema = z.object({
  ...entity, familyId: familyIdSchema, label: z.string().min(1).max(250), alpha: z.number().positive(), beta: z.number().positive(),
  lastSeenAt: timestamp, fsrsStability: z.number().nonnegative(), fsrsDifficulty: z.number().nonnegative(), dueAt: timestamp,
  evLostTotal: z.number().finite().nonnegative().default(0), reps: z.number().int().nonnegative().default(0),
  lapses: z.number().int().nonnegative().default(0), lastReviewedAt: timestamp.nullable().default(null),
});
/** A deal shown on a heuristic card: the cards, the card's hold and a best hold (masks over `hand`). */
export const heuristicExampleSchema = z.object({
  hand: z.array(z.number().int().min(0).max(51)).length(5), mask: z.number().int().min(0).max(31), bestMask: z.number().int().min(0).max(31),
  evLoss: z.number().finite().nonnegative(), weight: z.number().int().positive(), exception: z.boolean(),
});
/**
 * A personal heuristic card (docs/17-HEURISTICS-PLAN.md): a rule "hold A over B, unless …" on one pay table at one bet,
 * scored by the engine over every deal (costs in percentage points of return). `source`: engine-written from your
 * mistakes, or saved from the Rule Lab. Words may be polished by AI (`aiModel`), the rule never is.
 */
export const heuristicSchema = z.object({
  ...entity, paytableId: hash, coins: z.number().int().min(1).max(5).default(5),
  source: z.enum(["engine", "lab"]).default("engine"),
  targetLabelPair: z.tuple([z.string(), z.string()]), ruleAst: z.record(z.unknown()),
  ruleText: z.string().max(600), mnemonic: z.string().max(300), exceptions: z.array(z.string().max(400)).max(5),
  examples: z.array(heuristicExampleSchema).max(8), counterexamples: z.array(heuristicExampleSchema).max(8).default([]),
  costPct: z.number().finite(), costWithoutExceptionsPct: z.number().finite().nonnegative().default(0),
  appliesFreq: z.number().min(0).max(1).default(0), rightFreq: z.number().min(0).max(1).default(0),
  aiModel: z.string().nullable().default(null), mnemonicStyle: z.string().nullable().default(null),
  status: z.enum(["active", "mastered", "archived"]), createdAt: timestamp,
});
export const uploadSchema = z.object({
  ...entity, kind: z.enum(["paytable", "hand"]), imageBlob: z.instanceof(Blob).optional(),
  extracted: z.unknown(), confirmed: z.boolean(), provider: z.string(), model: z.string(), createdAt: timestamp, expiresAt: timestamp,
});
export const scoutingSchema = z.object({
  ...entity, paytableId: hash, casino: z.string(), location: z.string(), denominationCents: positiveCents, seenAt: timestamp, notes: z.string(),
});
/**
 * A casino loyalty program. `carryover`: coin-in accumulates across sessions and a point is earned at each full
 * `dollarsPerPoint` (the remainder carries over); `session_floor`: each session rounds down on its own; `fractional`:
 * no rounding. Free play earns no points unless `freePlayEarnsPoints`.
 */
export const rewardsProgramSchema = z.object({
  ...entity, name: nameSchema, casinoName: z.string().max(100), dollarsPerPoint: z.number().finite().positive().max(10_000),
  rounding: z.enum(["carryover", "session_floor", "fractional"]).default("carryover"), freePlayEarnsPoints: z.boolean().default(false),
  tiers: z.array(z.object({ name: nameSchema, points: z.number().int().nonnegative() })).max(20), notes: z.string().max(2000), isBuiltIn: z.boolean(),
  createdAt: timestamp,
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const tripDaySchema = z.object({ date: isoDate, type: z.enum(["sea", "port"]), casinoHoursPlanned: z.number().min(0).max(24) });
export const tripSchema = z.object({
  ...entity, programId: uuid, shipName: nameSchema, sailStart: isoDate, sailEnd: isoDate,
  days: z.array(tripDaySchema).max(120),
  targetPoints: z.number().int().nonnegative(), startingPoints: z.number().int().nonnegative().optional(), notes: z.string().max(2000),
  status: z.enum(["planned", "active", "done"]), createdAt: timestamp,
}).refine(trip => trip.sailStart <= trip.sailEnd, "The trip must end on or after the day it starts.");
export const pauseReasons = ["drink", "break", "hand_pay", "machine_fault", "other"] as const;
/**
 * One stretch of real play at one machine. Only readings are stored (cash, points, hands, time); coin-in, points earned
 * and costs are derived on read, so changing a program's rules recalculates history. `coinInCents` keeps only an
 * estimated coin-in (source "estimate"), fixed when the session was closed.
 */
export const casinoSessionSchema = z.object({
  ...entity, tripId: uuid, machineId: uuid.optional(), paytableId: hash.optional(), familyId: familyIdSchema.optional(),
  gameName: z.string().max(200).default(""),
  denominationCents: positiveCents, coins: z.number().int().min(1).max(5), lines: z.number().int().positive().max(100),
  startedAt: timestamp, endedAt: timestamp.nullable(),
  timeSegments: z.array(z.object({ start: timestamp, end: timestamp.optional(), pauseReason: z.enum(pauseReasons).optional() })).min(1),
  activeMs: z.number().nonnegative(), cashInCents: cents.nonnegative(), cashOutCents: cents.nonnegative(),
  freePlayUsedCents: cents.nonnegative(), freePlayWonCents: cents.nonnegative().default(0),
  pointsBefore: z.number().int().nonnegative().optional(), pointsAfter: z.number().int().nonnegative().optional(),
  handsCount: z.number().int().nonnegative().optional(), coinInCents: cents.nonnegative(),
  coinInSource: z.enum(["points", "hands", "estimate"]),
  jackpots: z.array(z.object({ amountCents: cents.nonnegative(), handRank: z.string().max(100).optional(), at: timestamp })), notes: z.string().max(2000),
});
export const rewardSchema = z.object({
  ...entity, tripId: uuid.optional(), programId: uuid, description: z.string().trim().min(1).max(200),
  type: z.enum(["cruise", "upgrade", "freeplay", "obc", "discount", "other"]),
  valueCents: cents.nonnegative(), receivedAt: timestamp, notes: z.string().max(2000),
});
export const dailyAggregateSchema = z.object({
  ...entity, bucketKey: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().min(1), paytableId: hash, analysisKey: hash,
  coins: z.number().int().min(1).max(5), variantKind: z.literal("standard"), mode: sessionSchema.shape.mode,
  /** Absent on buckets archived before denominations were tracked; those cannot be shown in dollars. */
  denominationCents: positiveCents.optional(),
  bestLabel: z.string().min(1).max(250), chosenLabel: z.string().min(1).max(250),
  n: z.number().int().nonnegative(), errors: z.number().int().nonnegative(), evLostTotal: z.number().finite().nonnegative(),
  weightedN: z.number().finite().nonnegative(), weightedErrors: z.number().finite().nonnegative(),
  weightedEvLost: z.number().finite().nonnegative(), excludedCorrections: z.number().int().nonnegative(),
  firstAt: timestamp, lastAt: timestamp,
}).superRefine((row, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  try {
    if (localDay(row.firstAt, row.timeZone) !== row.day || localDay(row.lastAt, row.timeZone) !== row.day) issue("Aggregate dates do not match its local day.");
  } catch { issue("Invalid aggregate timezone or date."); }
  if (row.firstAt > row.lastAt || row.errors > row.n || row.weightedErrors > row.weightedN + 1e-9 ||
    (!row.n && (row.weightedN || row.weightedErrors || row.evLostTotal || row.weightedEvLost)) ||
    (row.n > 0 && row.weightedN <= 0) || (row.errors === 0 && (row.evLostTotal || row.weightedEvLost || row.weightedErrors)) ||
    (row.errors > 0 && (row.evLostTotal <= 0 || row.weightedEvLost <= 0 || row.weightedErrors <= 0)) ||
    row.n + row.excludedCorrections === 0) issue("Inconsistent aggregate counts or losses.");
  // Buckets archived before denominations were tracked have no denomination in their key or record.
  const keyParts: unknown[] = [row.day, row.paytableId, row.coins, row.variantKind, row.bestLabel, row.chosenLabel, row.analysisKey, row.mode, row.timeZone];
  if (row.denominationCents !== undefined) keyParts.push(row.denominationCents);
  if (row.bucketKey !== JSON.stringify(keyParts)) issue("Invalid aggregate bucket key.");
});
