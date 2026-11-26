import { z } from "zod";
import * as r from "./records";
import * as f from "./future-records";
import { feedbackModeSchema } from "./play-state";

export const walletCreateSchema = z.object({ name: r.nameSchema, initialCents: r.cents.nonnegative().default(0) });
export const walletTopupSchema = z.object({ walletId: r.uuid, amountCents: r.positiveCents });
export const walletTransferSchema = z.object({ fromId: r.uuid, toId: r.uuid, amountCents: r.positiveCents }).refine(x => x.fromId !== x.toId, "Choose two different wallets");
export const sessionStartSchema = z.object({
  machineId: r.uuid, walletId: r.uuid.optional(), mode: r.sessionSchema.shape.mode,
  trainingFocus: r.sessionSchema.shape.trainingFocus.optional(),
  pace: r.paceSchema.optional(), feedbackMode: feedbackModeSchema.optional(), training: r.trainingSchema.optional(),
}).refine(x => !x.trainingFocus || x.mode === "drill", "Targeted categories require Rapid Drill")
  .refine(x => !x.training || (x.mode === "drill" && !x.trainingFocus), "Training plans run in Rapid Drill")
  .refine(x => !x.pace || x.mode === "free_play", "Pace training plays full Free Play hands");
export const sessionActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hold"), heldMask: z.number().int().min(0).max(31), handId: r.uuid.nullable().optional() }),
  z.object({ type: z.literal("feedback"), feedbackMode: feedbackModeSchema }),
  z.object({ type: z.literal("bet"), coins: z.number().int().min(1).max(5) }),
  // Full state is validated; credits, bankroll, payouts and summary are never client-writable.
  z.object({ type: z.literal("saveHand"), hand: r.handSchema.refine(x => x.length === 5), heldMask: z.number().int().min(0).max(31).default(0) }),
]);
export const recordSchemas = {
  profile: r.profileSchema, aiSettings: r.aiSettingsSchema, aiKeys: r.aiKeySchema, aiUsage: r.aiUsageSchema, aiExplanations: r.aiExplanationSchema,
  paytables: r.paytableSchema, analyses: r.analysisSchema, machines: r.machineSchema, wallets: r.walletSchema,
  walletLedger: r.ledgerSchema, sessions: r.sessionSchema, decisions: r.decisionSchema,
  categoryMastery: f.masterySchema, heuristicCards: f.heuristicSchema, uploads: f.uploadSchema, scoutingLog: f.scoutingSchema,
  rewardsPrograms: f.rewardsProgramSchema, trips: f.tripSchema, casinoSessions: f.casinoSessionSchema,
  rewardsReceived: f.rewardSchema, dailyAggregates: f.dailyAggregateSchema,
} as const;
export type TableName = keyof typeof recordSchemas;
export type Records = { [K in TableName]: z.infer<(typeof recordSchemas)[K]> };
export type SessionAction = z.input<typeof sessionActionSchema>;
export const decisionQuerySchema = z.object({
  sessionId: r.uuid.optional(), paytableId: r.hash.optional(), since: r.timestamp.optional(),
  includeCorrections: z.boolean().default(false),
});
export interface DecisionService {
  record(input: z.input<typeof r.decisionSchema>): Promise<Records["decisions"]>;
  query(input?: z.input<typeof decisionQuerySchema>): Promise<Records["decisions"][]>;
}
export interface PlayService {
  deal(id: string, expectedHandId: string | null): Promise<r.Session>;
  submit(id: string, handId: string, confirmMistake?: boolean): Promise<r.Session>;
}
export interface MachineService {
  list(): Promise<r.Machine[]>;
  save(input: z.input<typeof r.machineDraftSchema>, id?: string): Promise<r.Machine>;
  remove(id: string): Promise<void>;
}
export interface WalletService {
  list(): Promise<r.Wallet[]>;
  create(input: z.input<typeof walletCreateSchema>): Promise<r.Wallet>;
  rename(id: string, name: string): Promise<r.Wallet>;
  topup(input: z.input<typeof walletTopupSchema>): Promise<r.Wallet>;
  transfer(input: z.input<typeof walletTransferSchema>): Promise<void>;
  ledger(walletId: string): Promise<r.WalletLedger[]>;
}
export interface SessionService {
  list(): Promise<r.Session[]>;
  start(input: z.input<typeof sessionStartSchema>): Promise<r.Session>;
  activate(id: string): Promise<void>;
  pause(id: string): Promise<r.Session>;
  resume(id: string): Promise<r.Session>;
  close(id: string): Promise<r.Session>;
  applyAction(id: string, input: SessionAction): Promise<r.Session>;
}
