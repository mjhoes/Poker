import { z } from "zod";
import { v7 } from "uuid";
import { drawDecksSchema, feedbackModeSchema, gradeSchema, handAnalysisSchema, outcomeSchema } from "./play-state";

export const newId = () => v7();
export const uuid = z.string().uuid().refine(id => id[14] === "7", "Expected a UUIDv7");
export const timestamp = z.number().int().nonnegative().safe();
export const cents = z.number().int().safe();
export const positiveCents = cents.positive();
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const familyIdSchema = z.enum(["jacks_or_better", "bonus_poker", "bonus_poker_deluxe", "double_bonus", "double_double_bonus", "deuces_wild"]);
export const variantKindSchema = z.enum(["standard", "ultimate_x", "super_times_pay", "multi_strike", "dream_card"]);
export const variantSchema = z.object({ kind: variantKindSchema.default("standard"), config: z.record(z.unknown()).default({}) }).default({ kind: "standard", config: {} });
export const variantStateSchema = z.record(z.unknown()).default({});
export const metadata = { updatedAt: timestamp, deletedAt: timestamp.nullable().default(null) };
export const entity = { id: uuid, ...metadata };
export const nameSchema = z.string().trim().min(1).max(100);
export const recentHandSchema = z.object({
  hand: z.array(z.number().int().min(0).max(51)).length(5).refine(cards => new Set(cards).size === 5, "Duplicate cards"),
  paytableId: hash, coins: z.number().int().min(1).max(5), at: timestamp,
});
export const profileSchema = z.object({
  id: z.literal("local"), displayName: nameSchema.default("Player"), createdAt: timestamp, ...metadata,
  prefs: z.object({ activeSessionId: uuid.nullable().default(null), lastBackupAt: timestamp.nullable().default(null), lastBackupDecisionCount: z.number().int().nonnegative().default(0),
    /** Card colors: classic red/black, or four colors (diamonds blue, clubs green). */
    deckColors: z.enum(["two", "four"]).default("two"),
    /** Deal and draw animation pace, chosen at the table; applies to every machine. */
    dealSpeed: z.enum(["relaxed", "normal", "fast"]).default("normal"),
    /** The Hand Analyzer's recent hands, newest first. */
    recentHands: z.array(recentHandSchema).max(20).default([]),
    /** Review cards served a day before "Keep going" (adaptive training). */
    dailyReviewCap: z.number().int().min(5).max(500).default(50) }).default({}),
});
export const providerSchema = z.enum(["openai", "anthropic"]);
export const aiSettingsSchema = z.object({
  id: z.literal("local"), ...metadata,
  visionProvider: providerSchema.default("anthropic"), visionModel: z.string().default(""),
  coachProvider: providerSchema.default("anthropic"), coachModel: z.string().default(""),
  heuristicsProvider: providerSchema.default("anthropic"), heuristicsModel: z.string().default(""),
  fallbackEnabled: z.boolean().default(false), rememberKeys: z.boolean().default(false),
  /** Light / medium / heavy model for coaching text; a non-empty *Model field overrides it. */
  coachTier: z.enum(["light", "medium", "heavy"]).default("heavy"),
  visionTier: z.enum(["light", "medium", "heavy"]).default("medium"),
});
export const aiTierSchema = z.enum(["light", "medium", "heavy"]);
/** A saved AI explanation of one hold comparison, so the same question is never paid for twice. Not in backups. */
export const aiExplanationSchema = z.object({
  id: z.string().min(1).max(300), ...metadata, createdAt: timestamp,
  provider: providerSchema, model: z.string().min(1), tier: aiTierSchema, promptVersion: z.number().int().positive(),
  explanation: z.object({
    summary: z.string().min(1).max(2000), why: z.string().min(1).max(2000), howToRemember: z.string().min(1).max(2000),
    commonMistake: z.string().max(2000).nullable(),
  }),
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), estCost: z.number().finite().nonnegative(),
});
export const aiKeySchema = z.object({ provider: providerSchema, key: z.string().min(1), ...metadata });
export const aiUsageSchema = z.object({
  ...entity, provider: providerSchema, model: z.string(), task: z.string(),
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  estCost: z.number().finite().nonnegative(), createdAt: timestamp,
});
/** Engine-computed whole-game figures for one bet (coins per line). Small and regenerable. */
export const gameSummarySchema = z.object({
  returnPct: z.number().finite(), hitFreq: z.number().finite().min(0).max(1),
  variance: z.number().finite().nonnegative(), engineVersion: z.string(),
  /** Chance of each final hand under optimal play (the luck band's distribution); absent on figures saved earlier. */
  rankProbs: z.array(z.number().finite().min(0).max(1)).max(32).optional(),
});
export const paytableSchema = z.object({
  id: hash, ...metadata, familyId: familyIdSchema, name: nameSchema,
  pays: z.record(z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().nonnegative()])),
  source: z.enum(["library", "photo", "manual"]), createdAt: timestamp,
  /** Engine-computed max-bet (5-coin) figures for a custom table, saved with it so lists can show the return. */
  computed: gameSummarySchema.optional(),
  /** Saved per-bet figures (keys "1"–"5"), so the table analysis panel never recomputes or downloads twice. */
  summaries: z.record(z.enum(["1", "2", "3", "4", "5"]), gameSummarySchema).optional(),
});
export const analysisSchema = z.object({
  key: hash, ...metadata, paytableId: hash, variantKind: variantKindSchema.default("standard"),
  variantStateKey: z.string().default("standard"), returnPct: z.number().finite(),
  variance: z.number().finite().nonnegative(), hitFreq: z.number().finite().min(0).max(1),
  rankProbs: z.array(z.number().finite().min(0).max(1)), perHandBlob: z.instanceof(Blob),
  strategyLists: z.array(z.unknown()), engineVersion: z.string(), computedAt: timestamp,
});
export const machineDraftSchema = z.object({
  name: nameSchema, paytableId: hash, variant: variantSchema,
  denominationCents: positiveCents.max(100000), coins: z.number().int().min(1).max(5).default(5),
  lines: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)]).default(1),
  theme: z.enum(["felt", "midnight", "classic", "royal", "ocean", "onyx"]).default("felt"),
  speed: z.enum(["relaxed", "normal", "fast"]).default("normal"),
  defaultWalletId: uuid, casinoName: z.string().max(120).default(""),
  location: z.string().max(200).default(""), notes: z.string().max(2000).default(""),
});
export const machineSchema = machineDraftSchema.extend({ ...entity });
export const walletSchema = z.object({ ...entity, name: nameSchema, balanceCents: cents.nonnegative(), createdAt: timestamp });
export const ledgerSchema = z.object({
  ...entity, walletId: uuid, sessionId: uuid.optional(), transferId: uuid.optional(),
  type: z.enum(["topup", "transfer", "bet", "win", "adjust"]), amountCents: cents,
  balanceAfterCents: cents.nonnegative(), createdAt: timestamp,
});
export const handSchema = z.array(z.number().int().min(0).max(51)).refine(cards => cards.length === 0 || cards.length === 5, "A hand must have five cards").refine(cards => new Set(cards).size === cards.length, "Cards must be distinct");
export const sessionStateSchema = z.object({
  hand: handSchema.default([]), heldMask: z.number().int().min(0).max(31).default(0),
  phase: z.enum(["ready", "holding", "complete"]).default("ready"),
  credits: z.number().finite().nonnegative().default(0), variantState: variantStateSchema,
  creditRemainderCents: cents.nonnegative().default(0),
  primaryGrade: gradeSchema.nullable().default(null),
  handId: uuid.nullable().default(null), handIndex: z.number().int().nonnegative().default(0),
  dealtAt: timestamp.nullable().default(null), decisionStartedAt: timestamp.nullable().default(null),
  decisionElapsedMs: timestamp.default(0), analysis: handAnalysisSchema.nullable().default(null),
  drawDecks: drawDecksSchema.default([]), feedbackMode: feedbackModeSchema.default("warn_before_draw"),
  warning: gradeSchema.nullable().default(null), feedback: gradeSchema.nullable().default(null),
  outcome: outcomeSchema.nullable().default(null), attempts: z.number().int().nonnegative().default(0),
  priorOutcome: z.string().nullable().default(null),
  /** Coins per line chosen for the next deal; null means the machine's default bet. */
  betCoins: z.number().int().min(1).max(5).nullable().default(null),
  /** Coins per line locked for the hand in play (or last played); null on hands dealt before bets could change. */
  handCoins: z.number().int().min(1).max(5).nullable().default(null),
  /** The pay table of the hand in play when it isn't the machine's (a Pay Table Switcher round); null = the machine's. */
  handPaytableId: hash.nullable().default(null),
}).superRefine((state, ctx) => {
  if (state.hand.length === 0 && (state.heldMask !== 0 || state.phase !== "ready")) ctx.addIssue({ code: "custom", message: "A non-ready state needs a hand" });
  if (state.handId) {
    if (!state.analysis || state.dealtAt === null || state.handIndex < 1 || !state.drawDecks.length) {
      ctx.addIssue({ code: "custom", message: "A dealt round requires its analysis, draw decks, timestamp and index" });
    } else {
      if (state.drawDecks.some(deck => deck.some(card => state.analysis!.hand.includes(card)))) ctx.addIssue({ code: "custom", message: "Draw decks must exclude all originally dealt cards" });
      if (state.phase === "holding" && state.hand.some((card, index) => card !== state.analysis!.hand[index])) ctx.addIssue({ code: "custom", message: "Holding cards must match the original deal" });
    }
    if (state.phase === "complete" && !state.feedback) ctx.addIssue({ code: "custom", message: "A completed round requires saved feedback" });
  }
});
export const sessionSummarySchema = z.object({
  hands: z.number().int().nonnegative().default(0), coinInCents: cents.nonnegative().default(0),
  netCents: cents.default(0), errors: z.number().int().nonnegative().default(0),
  evLost: z.number().finite().nonnegative().default(0), biggestWinCents: cents.nonnegative().default(0),
  topMistakes: z.array(z.object({ label: z.string(), count: z.number().int().nonnegative() })).default([]),
  mistakeCounts: z.record(z.number().int().nonnegative()).default({}),
}).default({});
/** Adaptive training plan for a Rapid Drill session (docs/15-ADAPTIVE-TRAINING-PLAN.md). */
export const ladderTierSchema = z.enum(["Beginner", "Intermediate", "Expert"]);
/**
 * Strategy Ladder progress (docs/16-ADAPTIVE-TRAINING-ROUND-B.md): the chart, its practicable lines (chart line indexes,
 * top-down), how many are unlocked (`step`; past the last = mixed review), the run of right answers on the newest
 * line, and the line of the hand in play.
 */
export const ladderStateSchema = z.object({
  tier: ladderTierSchema,
  lines: z.array(z.number().int().min(0).max(500)).min(1).max(200),
  step: z.number().int().min(1), streak: z.number().int().min(0),
  pending: z.number().int().min(0).nullable().default(null),
  /**
   * When this ladder's progress last changed (started, started over, or answered). The latest ladder on a chart is the
   * one with the newest progress, not the newest session update: closing an old session must not undo a Start over.
   */
  progressAt: timestamp,
});
/** Pay Table Switcher: the tables (the machine's first) and the round in play (its cards, and the next table's index). */
export const switcherStateSchema = z.object({
  tables: z.array(hash).min(2).max(3),
  round: z.object({ hand: z.array(z.number().int().min(0).max(51)).length(5), next: z.number().int().min(1).max(3) }).nullable().default(null),
});
export const trainingSchema = z.object({
  kind: z.enum(["review", "weakness", "close_calls", "ladder", "switcher"]),
  /** Review: keep serving due cards past the daily cap. */
  keepGoing: z.boolean().default(false),
  /** Close calls: the largest EV gap between the best two holds, in credits per coin bet. */
  closeCallPerCoin: z.number().min(0.01).max(0.5).optional(),
  /** Weakness Trainer: the confusion pairs to train, weighted by what they cost. */
  targets: z.array(z.object({ bestLabel: z.string().min(1).max(250), chosenLabel: z.string().min(1).max(250), weight: z.number().finite().nonnegative() })).max(5).optional(),
  ladder: ladderStateSchema.optional(),
  switcher: switcherStateSchema.optional(),
}).refine(training => (training.kind === "ladder") === !!training.ladder && (training.kind === "switcher") === !!training.switcher,
  "A Strategy Ladder or Pay Table Switcher session needs its plan.");
export const paceSchema = z.object({
  targetHandsPerHour: z.number().int().min(100).max(3000), accuracyPct: z.number().min(90).max(100),
  /** The trip whose needed pace set the target, if any. */
  tripId: uuid.optional(),
});
export const sessionSchema = z.object({
  ...entity, machineId: uuid, walletId: uuid,
  // Snapshot terms: editing a machine must not change a hand already in progress.
  machineSnapshot: machineDraftSchema,
  variant: variantSchema,
  mode: z.enum(["free_play", "drill", "weakness", "close_calls", "ladder", "switcher", "exam", "casino_log"]).default("free_play"),
  status: z.enum(["active", "paused", "closed"]).default("active"), state: sessionStateSchema,
  startedAt: timestamp, endedAt: timestamp.nullable().default(null), summary: sessionSummarySchema,
  activeMs: z.number().finite().nonnegative().default(0), handsPerHour: z.number().finite().nonnegative().default(0),
  trainingFocus: z.object({ label: z.string().min(1).max(250), analysisKey: hash }).nullable().default(null),
  virtualCoinInCents: cents.nonnegative().default(0), virtualPoints: z.number().finite().nonnegative().default(0),
  /** Casino-Pace Mode: a Free Play session trained toward a pace while holding an accuracy bar (% of perfect play's EV). */
  pace: paceSchema.nullable().default(null),
  training: trainingSchema.nullable().default(null),
});
export const decisionSchema = z.object({
  ...entity, sessionId: uuid, paytableId: hash, analysisKey: hash,
  variantKind: variantKindSchema.default("standard"), variantState: variantStateSchema,
  canonicalHandId: z.number().int().nonnegative(), dealtCards: handSchema.refine(x => x.length === 5),
  chosenMask: z.number().int().min(0).max(31), bestMask: z.number().int().min(0).max(31),
  chosenEv: z.number().finite(), bestEv: z.number().finite(), evLoss: z.number().finite().nonnegative(),
  chosenLabel: z.string(), bestLabel: z.string(), gapToSecond: z.number().finite().nonnegative(),
  decisionMs: z.number().finite().nonnegative(), handIndexInSession: z.number().int().nonnegative(),
  msSinceSessionStart: z.number().finite().nonnegative(), priorOutcome: z.string().nullable(), createdAt: timestamp,
  handId: uuid.nullable().default(null), isCorrection: z.boolean().default(false), attemptIndex: z.number().int().nonnegative().default(0),
  coins: z.number().int().min(1).max(5).default(5), lines: z.number().int().min(1).max(10).default(1),
  denominationCents: positiveCents.default(25),
});
export type Paytable = z.infer<typeof paytableSchema>;
export type GameSummary = z.infer<typeof gameSummarySchema>;
export type RecentHand = z.infer<typeof recentHandSchema>;
export type AiTier = z.infer<typeof aiTierSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type AiExplanation = z.infer<typeof aiExplanationSchema>;
export type AiProvider = z.infer<typeof providerSchema>;
export type Machine = z.infer<typeof machineSchema>;
export type MachineDraft = z.infer<typeof machineDraftSchema>;
export type Wallet = z.infer<typeof walletSchema>;
export type WalletLedger = z.infer<typeof ledgerSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
