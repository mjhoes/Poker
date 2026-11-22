import { z } from "zod";

const card = z.number().int().min(0).max(51);
export const dealtHandSchema = z.tuple([card, card, card, card, card]).refine(cards => new Set(cards).size === 5, "Cards must be distinct");
const finite = z.number().finite();
const holdResultSchema = z.object({
  mask: z.number().int().min(0).max(31), label: z.string(), ev: finite.nonnegative(),
  rankDist: z.array(finite.min(0).max(1)), rankCounts: z.array(z.number().int().nonnegative()),
  drawCount: z.number().int().positive(),
});
export const handAnalysisSchema = z.object({
  familyId: z.enum(["jacks_or_better", "bonus_poker", "bonus_poker_deluxe", "double_bonus", "double_double_bonus", "deuces_wild"]),
  valueVector: z.array(finite.nonnegative()), hand: dealtHandSchema,
  results: z.array(holdResultSchema).length(32).refine(rows => new Set(rows.map(row => row.mask)).size === 32),
  best: holdResultSchema, gapToSecond: finite.nonnegative(),
});
export const gradeSchema = z.object({
  chosenMask: z.number().int().min(0).max(31), bestMask: z.number().int().min(0).max(31),
  chosenEv: finite.nonnegative(), bestEv: finite.nonnegative(), evLoss: finite.nonnegative(),
  totalEvLoss: finite.nonnegative(), chosenLabel: z.string(), bestLabel: z.string(),
  gapToSecond: finite.nonnegative(), correct: z.boolean(),
});
export const feedbackModeSchema = z.enum(["warn_before_draw", "show_after_draw", "silent_report"]);
export const outcomeSchema = z.object({
  lines: z.array(z.object({ hand: dealtHandSchema, rank: z.string(), payoutCoins: finite.nonnegative() })).min(1).max(10),
  totalPayoutCoins: finite.nonnegative(),
});
export const drawDecksSchema = z.array(z.array(card).length(47).refine(deck => new Set(deck).size === 47)).max(10);
export type FeedbackMode = z.infer<typeof feedbackModeSchema>;
