import type { AnalysisProgress, DrillOptions, GameFamilyId, Hand, ValueVector } from "@perfect-draw/engine";
import type { GameAnalysis } from "@perfect-draw/engine";
import type { HandAnalysis, DrillHand } from "@perfect-draw/engine";
import type { StrategyList, StrategyTier } from "@perfect-draw/engine";
import type { RoundOutcome } from "@perfect-draw/engine";
import type { StatsQuery, StatsReportView, Session } from "@perfect-draw/shared";
import type { RiskBand } from "./risk";

export type GamePreview = { returnPct: number; hitFreq: number; variance: number; engineVersion: string };
/** Whole-game figures for one table and bet, and where they came from. */
export type TableSummary = GamePreview & { familyId: GameFamilyId; betCoins: number; source: "library" | "saved" | "computed" };
export type AnalysisSummary = Omit<GameAnalysis, "perHand"> & { key: string; strategyLists: readonly StrategyList[] };
/** Which line of a strategy chart picks the hold for a hand (max bet), and how that compares with the best hold. */
export type StrategyCitation = {
  tier: StrategyTier; mask: number; label: string; ev: number; bestMask: number; bestEv: number;
  /** Index into the chart's lines; null when no line applies (draw five). */
  line: number | null; lineCount: number; lineLabel: string | null; exception: boolean;
  chartReturnPct: number; optimalReturnPct: number; familyId: GameFamilyId;
};
/** The same five cards on another table: its best hold and the value of every hold there (by mask). */
export type AcrossAnalysis = { paytableId: string; coins: number; familyId: GameFamilyId; bestMask: number; bestLabel: string; bestEv: number; evByMask: number[] };
/** How a table's perfect strategy differs from a built-in table of the same game, over every possible deal. */
export type StrategyDifference = {
  baseId: string; differPct: number;
  /** The most common deals where the best hold changes (the hand as dealt, and each table's best hold). */
  examples: { hand: number[]; best: string; baseBest: string; dealsPct: number }[];
};
/** What an adaptive-training deal asks for: categories, a confused pair, and/or a close-call gap (total coins at the bet). */
export type DealTarget = { labels?: string[]; pairs?: { correct: string; confusedWith: string }[]; closeCallMaxGap?: number };
export interface EngineAPI {
  rollupDecisions(timeZone: string): Promise<number>;
  /** A dealt round; a focused drill (`focus`) or an adaptive-training `target` picks the hand. */
  prepareRound(paytableId: string, coins: number, lines: number, focus?: Session["trainingFocus"], target?: DealTarget): Promise<{ analysis: HandAnalysis; drawDecks: number[][] }>;
  statistics(input: StatsQuery): Promise<StatsReportView>;
  validateTraining(paytableId: string, coins: number, label: string): Promise<string>;
  resolveRound(hand: Hand, mask: number, decks: number[][], paytableId: string, coins: number): Promise<RoundOutcome>;
  analyzeHand(cards: Hand, paytableId: string, coins: number): Promise<HandAnalysis>;
  analyzeGame(familyId: GameFamilyId, vector: ValueVector, betCoins: number, progress?: (value: AnalysisProgress) => void): Promise<AnalysisSummary>;
  loadAnalysis(keyOrPaytableId: string): Promise<AnalysisSummary>;
  /** Max-bet return for an unsaved pay table (the editor's live figure). Nothing is cached. */
  previewGame(familyId: GameFamilyId, vector: ValueVector): Promise<GamePreview>;
  /** Return, variance and hit frequency for a table at a bet, without loading the full hand-by-hand analysis. */
  tableSummary(paytableId: string, coins: number): Promise<TableSummary>;
  /**
   * The luck band for a stretch of play: 10th/50th/90th percentile result and the chance to finish ahead, from the
   * table's real hand distribution (computed once for a custom table or a bet below max, then saved).
   */
  riskBand(input: { paytableId: string; coins: number; betCents: number; hands: number; mistakePct: number }): Promise<RiskBand>;
  /** Downloads a built-in table's analysis file (without loading it) so it is available offline. */
  warmOffline(paytableId: string): Promise<boolean>;
  generateDrill(options: Omit<DrillOptions, "random">): Promise<DrillHand>;
  /** Whether a table's strategy charts are available without a long computation (built in, or computed before). */
  hasStrategyCharts(paytableId: string): Promise<boolean>;
  /** Cites the chart line that picks this hand's hold at max bet. May download or compute the table's analysis. */
  strategyCitation(cards: Hand, paytableId: string, tier: StrategyTier): Promise<StrategyCitation>;
  /** Compares perfect strategy with a built-in table (computes this table's full analysis first if needed, ~20 s). */
  strategyDifference(paytableId: string, baseId: string, progress?: (value: AnalysisProgress) => void): Promise<StrategyDifference>;
  /** The same hand on several tables (each at its own bet); deleted or unknown tables are skipped. */
  analyzeAcross(cards: Hand, targets: readonly { paytableId: string; coins: number }[]): Promise<AcrossAnalysis[]>;
}
