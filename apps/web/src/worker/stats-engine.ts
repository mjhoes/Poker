import {
  analyzeGame, analyzeHandFast, categoryDistribution, clearSubsetCache, computeStatistics,
  clearTrainingCache, generateHand, registerTrainingAnalysis, standardVariant,
} from "@perfect-draw/engine";
import type { GameAnalysis, HandAnalysis } from "@perfect-draw/engine";
import { analysisKey } from "@perfect-draw/paytables";
import { decisionSchema, recordSchemas, statsQuerySchema } from "@perfect-draw/shared";
import type { StatsQuery, StatsReportView } from "@perfect-draw/shared";
import { db, live, requireRecord } from "../data/db";

/** Derived short-coin analyses need no strategy induction or incompatible asset-schema changes. */
export class StatsEngine {
  private readonly games = new Map<string, GameAnalysis>();
  constructor(
    private readonly loadLibrary: (paytableId: string) => Promise<GameAnalysis>,
    private readonly prepareFamily: (family: string) => void = () => clearSubsetCache(),
  ) {}
  async game(paytableId: string, coins: number) {
    if (!Number.isInteger(coins) || coins < 1 || coins > 5) throw new Error("Choose 1–5 coins.");
    const table = await requireRecord("paytables", paytableId);
    const vector = standardVariant.valueVector(table, coins, {});
    const key = analysisKey(table.familyId, vector, coins);
    const cached = this.games.get(key);
    if (cached) return { key, analysis: cached };
    let analysis: GameAnalysis;
    if (coins === 5) {
      try { analysis = await this.loadLibrary(paytableId); }
      catch {
        // Exact local recomputation is available even for an unopened table offline.
        this.prepareFamily(table.familyId);
        analysis = analyzeGame(table.familyId, vector, undefined, { betCoins: coins });
      }
    } else {
      this.prepareFamily(table.familyId);
      analysis = analyzeGame(table.familyId, vector, undefined, { betCoins: coins });
    }
    if (analysisKey(analysis.familyId, analysis.valueVector, analysis.betCoins) !== key) throw new Error("Statistics analysis does not match the selected bet.");
    this.games.set(key, analysis);
    while (this.games.size > 2) {
      const oldest = this.games.keys().next().value!;
      this.games.delete(oldest); clearTrainingCache(oldest);
    }
    return { key, analysis };
  }
  async report(input: StatsQuery): Promise<StatsReportView> {
    const query = statsQuerySchema.parse(input);
    const { key, analysis } = await this.game(query.paytableId, query.coins);
    const now = Date.now(), until = Math.min(now, query.until ?? now);
    // One read transaction cannot observe the delete and aggregate halves of a rollup separately.
    const [decisions, sessions, archived] = await db.transaction("r", [db.records("decisions"), db.records("sessions"), db.records("dailyAggregates")], () => Promise.all([
      db.records("decisions").where("paytableId").equals(query.paytableId).toArray(),
      db.records("sessions").toArray(),
      db.records("dailyAggregates").where("paytableId").equals(query.paytableId).toArray(),
    ]));
    const sessionMap = new Map(sessions.filter(live).map(row => [row.id, row]));
    let excludedIncompatible = 0, undenominatedArchived = 0;
    const denominations = new Set<number>();
    const observations = [];
    for (const raw of decisions) {
      if (!live(raw) || raw.createdAt < (query.since ?? 0) || raw.createdAt > until) continue;
      const decision = decisionSchema.parse(raw);
      const session = sessionMap.get(decision.sessionId);
      if (!session || session.machineSnapshot.coins !== query.coins ||
        (query.mode !== "all" && session.mode !== query.mode)) continue;
      if (decision.variantKind !== "standard" || decision.analysisKey !== key || decision.coins !== query.coins) { excludedIncompatible++; continue; }
      denominations.add(decision.denominationCents);
      if (query.denominationCents !== undefined && decision.denominationCents !== query.denominationCents) continue;
      const canonical = analysis.perHand.get(decision.canonicalHandId);
      if (!canonical) throw new Error("A saved decision is absent from the selected game analysis.");
      observations.push({
        bestLabel: canonical.bestLabel, chosenLabel: decision.chosenLabel, evLoss: decision.evLoss,
        createdAt: decision.createdAt, isCorrection: decision.isCorrection,
      });
    }
    const aggregates = [];
    for (const raw of archived) {
      if (!live(raw) || raw.coins !== query.coins || (query.mode !== "all" && raw.mode !== query.mode) ||
        raw.lastAt < (query.since ?? 0) || raw.firstAt > until) continue;
      const row = recordSchemas.dailyAggregates.parse(raw);
      if (row.analysisKey !== key) { excludedIncompatible += row.n + row.excludedCorrections; continue; }
      if (row.firstAt < (query.since ?? 0) || row.lastAt > until) throw new Error("Archived history can only be filtered by whole local days in its saved timezone. Widen the date range.");
      if (row.denominationCents === undefined) undenominatedArchived += row.n;
      else denominations.add(row.denominationCents);
      // A denomination filter cannot include archived buckets whose denomination was never recorded.
      if (query.denominationCents !== undefined && row.denominationCents !== query.denominationCents) continue;
      aggregates.push(row);
    }
    return {
      ...computeStatistics(observations, categoryDistribution(analysis), now, { timeZone: query.timeZone, aggregates }), excludedIncompatible,
      denominations: [...denominations].sort((a, b) => a - b), undenominatedArchived,
    };
  }
  async validateTraining(paytableId: string, coins: number, label: string) {
    const { key, analysis } = await this.game(paytableId, coins);
    if (![...analysis.perHand.values()].some(row => row.bestLabel === label)) throw new Error("No hands have this optimal category at the selected bet.");
    return key;
  }
  async prepareTarget(paytableId: string, coins: number, label: string, expectedKey: string): Promise<HandAnalysis> {
    const { key, analysis } = await this.game(paytableId, coins);
    if (key !== expectedKey) throw new Error("This training focus does not match the session's saved table.");
    registerTrainingAnalysis(key, analysis);
    const drill = generateHand({ analysisKey: key, targetLabels: [label], sampling: "real" });
    this.prepareFamily(analysis.familyId);
    return analyzeHandFast(drill.hand, analysis.valueVector, analysis.familyId);
  }
}
