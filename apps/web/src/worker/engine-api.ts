import type { AnalysisProgress, DrillOptions, GameFamilyId, Hand, ValueVector } from "@perfect-draw/engine";
import type { GameAnalysis } from "@perfect-draw/engine";
import type { HandAnalysis, DrillHand } from "@perfect-draw/engine";
import type { StrategyList } from "@perfect-draw/engine";
import type { RoundOutcome } from "@perfect-draw/engine";

export type AnalysisSummary = Omit<GameAnalysis, "perHand"> & { key: string; strategyLists: readonly StrategyList[] };
export interface EngineAPI {
  prepareRound(paytableId: string, coins: number, lines: number): Promise<{ analysis: HandAnalysis; drawDecks: number[][] }>;
  resolveRound(hand: Hand, mask: number, decks: number[][], paytableId: string, coins: number): Promise<RoundOutcome>;
  analyzeHand(cards: Hand, paytableId: string, coins: number): Promise<HandAnalysis>;
  analyzeGame(familyId: GameFamilyId, vector: ValueVector, betCoins: number, progress?: (value: AnalysisProgress) => void): Promise<AnalysisSummary>;
  loadAnalysis(keyOrPaytableId: string): Promise<AnalysisSummary>;
  generateDrill(options: Omit<DrillOptions, "random">): Promise<DrillHand>;
}
