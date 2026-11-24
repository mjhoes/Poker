import { z } from "zod";
import { hash, timestamp, uuid } from "./records";
import type { Session } from "./records";
import type { StatsReport } from "@perfect-draw/engine";
export type { StatsReport, CategoryStats, ConfusionStats, TrendStats } from "@perfect-draw/engine";

export const statsQuerySchema = z.object({
  paytableId: hash, coins: z.number().int().min(1).max(5).default(5),
  since: timestamp.optional(), until: timestamp.optional(),
  mode: z.enum(["all", "free_play", "drill"]).default("all"),
  /** Only decisions made at this denomination; dollar figures are exact within one denomination. */
  denominationCents: z.number().int().positive().max(100000).optional(),
  timeZone: z.string().refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid timezone").default("UTC"),
}).refine(x => x.since === undefined || x.until === undefined || x.since <= x.until, "Start date must precede end date");
export type StatsQuery = z.input<typeof statsQuerySchema>;
/** The engine report plus what the app needs to show dollars: denominations present in scope, and archived decisions with none recorded. */
export type StatsReportView = StatsReport & { denominations: number[]; undenominatedArchived: number };
export const trainingFocusSchema = z.object({ label: z.string().min(1).max(250), analysisKey: hash });
export const statsTrainingSchema = z.object({ machineId: uuid, label: z.string().min(1).max(250) });
export interface StatsService {
  report(input: StatsQuery): Promise<StatsReportView>;
  train(input: z.input<typeof statsTrainingSchema>): Promise<Session>;
}
