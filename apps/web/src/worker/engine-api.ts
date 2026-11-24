import type { AnalysisProgress, DrillOptions, GameFamilyId, Hand, ValueVector } from "@perfect-draw/engine";
import type { GameAnalysis } from "@perfect-draw/engine";
import type { HandAnalysis, DrillHand } from "@perfect-draw/engine";
import type { StrategyList } from "@perfect-draw/engine";
import type { RoundOutcome } from "@perfect-draw/engine";
import type { StatsQuery, StatsReportView, Session } from "@perfect-draw/shared";

export type GamePreview = { returnPct: number; hitFreq: number; variance: number; engineVersion: string };
export type AnalysisSummary = Omit<GameAnalysis, "perHand"> & { key: string; strategyLists: readonly StrategyList[] };
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
  generateDrill(options: Omit<DrillOptions, "random">): Promise<DrillHand>;
}
