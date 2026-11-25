import type { AnalysisProgress, DrillOptions, GameFamilyId, Hand, ValueVector } from "@perfect-draw/engine";
import type { GameAnalysis } from "@perfect-draw/engine";
import type { HandAnalysis, DrillHand } from "@perfect-draw/engine";
import type { StrategyList, StrategyTier } from "@perfect-draw/engine";
import type { RoundOutcome } from "@perfect-draw/engine";
import type { StatsQuery, StatsReportView, Session } from "@perfect-draw/shared";

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
export interface EngineAPI {
  rollupDecisions(timeZone: string): Promise<number>;
  prepareRound(paytableId: string, coins: number, lines: number, focus?: Session["trainingFocus"]): Promise<{ analysis: HandAnalysis; drawDecks: number[][] }>;
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
  /** Downloads a built-in table's analysis file (without loading it) so it is available offline. */
  warmOffline(paytableId: string): Promise<boolean>;
  generateDrill(options: Omit<DrillOptions, "random">): Promise<DrillHand>;
  /** Whether a table's strategy charts are available without a long computation (built in, or computed before). */
  hasStrategyCharts(paytableId: string): Promise<boolean>;
  /** Cites the chart line that picks this hand's hold at max bet. May download or compute the table's analysis. */
  strategyCitation(cards: Hand, paytableId: string, tier: StrategyTier): Promise<StrategyCitation>;
  /** The same hand on several tables (each at its own bet); deleted or unknown tables are skipped. */
  analyzeAcross(cards: Hand, targets: readonly { paytableId: string; coins: number }[]): Promise<AcrossAnalysis[]>;
}
