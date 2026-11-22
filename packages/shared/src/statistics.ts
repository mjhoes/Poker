import { z } from "zod";
import { hash, timestamp, uuid } from "./records";
import type { Session } from "./records";
import type { StatsReport } from "@perfect-draw/engine";
export type { StatsReport, CategoryStats, ConfusionStats, TrendStats } from "@perfect-draw/engine";

export const statsQuerySchema = z.object({
  paytableId: hash, coins: z.number().int().min(1).max(5).default(5),
  since: timestamp.optional(), until: timestamp.optional(),
  mode: z.enum(["all", "free_play", "drill"]).default("all"),
}).refine(x => x.since === undefined || x.until === undefined || x.since <= x.until, "Start date must precede end date");
export type StatsQuery = z.input<typeof statsQuerySchema>;
export const trainingFocusSchema = z.object({ label: z.string().min(1).max(250), analysisKey: hash });
export const statsTrainingSchema = z.object({ machineId: uuid, label: z.string().min(1).max(250) });
export interface StatsService {
  report(input: StatsQuery): Promise<StatsReport>;
  train(input: z.input<typeof statsTrainingSchema>): Promise<Session>;
}
