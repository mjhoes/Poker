import { z } from "zod";
import { entity, timestamp, nameSchema, uuid, hash, cents, positiveCents, familyIdSchema } from "./records";
import { sessionSchema } from "./records";
import { localDay } from "@perfect-draw/engine";

export const masterySchema = z.object({
  ...entity, familyId: familyIdSchema, label: z.string(), alpha: z.number().positive(), beta: z.number().positive(),
  lastSeenAt: timestamp, fsrsStability: z.number().nonnegative(), fsrsDifficulty: z.number().nonnegative(), dueAt: timestamp,
});
export const heuristicSchema = z.object({
  ...entity, paytableId: hash, targetLabelPair: z.tuple([z.string(), z.string()]), ruleAst: z.record(z.unknown()),
  ruleText: z.string(), mnemonic: z.string(), exceptions: z.array(z.string()), examples: z.array(z.unknown()),
  costPct: z.number().finite(), status: z.enum(["active", "mastered", "archived"]), createdAt: timestamp,
});
export const uploadSchema = z.object({
  ...entity, kind: z.enum(["paytable", "hand"]), imageBlob: z.instanceof(Blob).optional(),
  extracted: z.unknown(), confirmed: z.boolean(), provider: z.string(), model: z.string(), createdAt: timestamp, expiresAt: timestamp,
});
export const scoutingSchema = z.object({
  ...entity, paytableId: hash, casino: z.string(), location: z.string(), denominationCents: positiveCents, seenAt: timestamp, notes: z.string(),
});
export const rewardsProgramSchema = z.object({
  ...entity, name: nameSchema, casinoName: z.string(), dollarsPerPoint: z.number().finite().positive(),
  rounding: z.enum(["trip_floor", "session_floor", "fractional"]), freePlayEarnsPoints: z.boolean(),
  tiers: z.array(z.object({ name: nameSchema, points: z.number().nonnegative() })), notes: z.string(), isBuiltIn: z.boolean(),
});
export const tripSchema = z.object({
  ...entity, programId: uuid, shipName: z.string(), sailStart: z.string(), sailEnd: z.string(),
  days: z.array(z.object({ date: z.string(), type: z.enum(["sea", "port"]), casinoHoursPlanned: z.number().min(0).max(24) })),
  targetPoints: z.number().nonnegative(), startingPoints: z.number().nonnegative().optional(), notes: z.string(),
  status: z.enum(["planned", "active", "done"]),
});
export const casinoSessionSchema = z.object({
  ...entity, tripId: uuid, machineId: uuid.optional(), paytableId: hash.optional(), familyId: familyIdSchema.optional(),
  denominationCents: positiveCents, coins: z.number().int().min(1).max(5), lines: z.number().int().positive(),
  startedAt: timestamp, endedAt: timestamp.nullable(),
  timeSegments: z.array(z.object({ start: timestamp, end: timestamp.optional(), pauseReason: z.string().optional() })),
  activeMs: z.number().nonnegative(), cashInCents: cents.nonnegative(), cashOutCents: cents.nonnegative(),
  freePlayUsedCents: cents.nonnegative(), freePlayWonCents: cents.nonnegative(),
  pointsBefore: z.number().nonnegative().optional(), pointsAfter: z.number().nonnegative().optional(),
  handsCount: z.number().int().nonnegative().optional(), coinInCents: cents.nonnegative(),
  coinInSource: z.enum(["points", "hands", "estimate"]),
  jackpots: z.array(z.object({ amountCents: cents.nonnegative(), handRank: z.string().optional(), at: timestamp })), notes: z.string(),
});
export const rewardSchema = z.object({
  ...entity, tripId: uuid.optional(), programId: uuid, description: z.string(),
  type: z.enum(["cruise", "upgrade", "freeplay", "obc", "discount", "other"]),
  valueCents: cents.nonnegative(), receivedAt: timestamp, notes: z.string(),
});
export const dailyAggregateSchema = z.object({
  ...entity, bucketKey: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().min(1), paytableId: hash, analysisKey: hash,
  coins: z.number().int().min(1).max(5), variantKind: z.literal("standard"), mode: sessionSchema.shape.mode,
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
  if (row.bucketKey !== JSON.stringify([row.day, row.paytableId, row.coins, row.variantKind, row.bestLabel, row.chosenLabel, row.analysisKey, row.mode, row.timeZone])) issue("Invalid aggregate bucket key.");
});
