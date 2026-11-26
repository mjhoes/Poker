import type { DealTarget } from "./engine-api";
import {
  analyzeGame, analyzeHandFast, categoryDistribution, clearSubsetCache, computeStatistics,
  clearTrainingCache, generateHand, getCanonicalHands, registerTrainingAnalysis, standardVariant,
} from "@perfect-draw/engine";
import type { GameAnalysis, Hand, HandAnalysis } from "@perfect-draw/engine";
import { analysisKey } from "@perfect-draw/paytables";
import { decisionSchema, recordSchemas, statsQuerySchema } from "@perfect-draw/shared";
import type { StatsQuery, StatsReportView } from "@perfect-draw/shared";
import { db, live, requireRecord } from "../data/db";
import { bestHoldDiffers } from "./strategy-difference";

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
      // A session can mix bets; each decision records the coins it was played at.
      if (!session || decision.coins !== query.coins ||
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
  private readonly bestLabels = new Map<string, string[]>();
  /**
   * The categories that are a best hold somewhere on this table at this bet. Review cards are kept per game family, and
   * a category that is best on one table of a family need not be on another: only these can be dealt here.
   */
  async trainableLabels(paytableId: string, coins: number) {
    const { key, analysis } = await this.game(paytableId, coins);
    let labels = this.bestLabels.get(key);
    if (!labels) {
      labels = [...new Set([...analysis.perHand.values()].map(row => row.bestLabel))].sort();
      this.bestLabels.set(key, labels);
    }
    return labels;
  }
  /**
   * A hand for adaptive training: the target's confused pair, else its categories, else any real hand, always within
   * the close-call gap when one is asked for (a gap no hand meets is an error). A `strict` target (a review card) never
   * falls back to an unrelated hand: answering one would update another card and leave the review due.
   */
  async prepareDeal(paytableId: string, coins: number, target: DealTarget): Promise<HandAnalysis> {
    const { key, analysis } = await this.game(paytableId, coins);
    registerTrainingAnalysis(key, analysis);
    const gap = target.closeCallMaxGap;
    const attempts: Parameters<typeof generateHand>[0][] = [
      ...(target.pairs?.length ? [{ analysisKey: key, targetPairs: target.pairs, closeCallMaxGap: gap }] : []),
      ...(target.labels?.length ? [{ analysisKey: key, targetLabels: target.labels, closeCallMaxGap: gap }] : []),
      ...(target.strict ? [] : [{ analysisKey: key, closeCallMaxGap: gap }]),
    ];
    let lastError: unknown;
    for (const options of attempts) {
      try {
        const drill = generateHand({ ...options, sampling: "real" });
        this.prepareFamily(analysis.familyId);
        return analyzeHandFast(drill.hand, analysis.valueVector, analysis.familyId);
      } catch (error) { lastError = error; }
    }
    if (target.strict) throw new Error("This card's category isn't a best hold on this table at this bet.");
    throw lastError instanceof Error ? lastError : new Error("No hand fits this training plan.");
  }
  /**
   * Deal IDs where two tables' best holds differ: no hold is optimal under both. Shares the Strategy Difference check,
   * which re-solves tied deals exactly (three or more holds can tie).
   */
  private readonly differing = new Map<string, number[]>();
  private canonicalHands?: Map<number, Hand>;
  private async differIds(paytableId: string, other: string, coins: number) {
    const a = await this.game(paytableId, coins), b = await this.game(other, coins);
    if (a.analysis.familyId !== b.analysis.familyId) throw new Error("The Pay Table Switcher compares tables of the same game.");
    const cacheKey = `${a.key}|${b.key}`;
    let ids = this.differing.get(cacheKey);
    if (!ids) {
      this.canonicalHands ??= new Map(getCanonicalHands().map(hand => [hand.id, hand.hand]));
      this.prepareFamily(a.analysis.familyId); // tied deals are re-solved
      ids = [];
      for (const id of a.analysis.perHand.keys()) if (bestHoldDiffers(id, a.analysis, b.analysis, this.canonicalHands)) ids.push(id);
      this.differing.set(cacheKey, ids);
    }
    return ids;
  }
  /** The share of real deals (%) whose best hold differs between this table and each other one, at this bet. */
  async switcherDiffer(paytableId: string, others: readonly string[], coins: number) {
    const result: { paytableId: string; differPct: number }[] = [];
    for (const other of others) {
      const ids = await this.differIds(paytableId, other, coins);
      const { analysis } = await this.game(paytableId, coins);
      result.push({ paytableId: other, differPct: ids.reduce((sum, id) => sum + analysis.perHand.get(id)!.weight, 0) * 100 / 2598960 });
    }
    return result;
  }
  /** A Pay Table Switcher round's hand on its first table: one whose best hold differs on another table, or any. */
  async switcherDeal(paytableId: string, others: readonly string[], coins: number, differ: boolean): Promise<HandAnalysis> {
    const union = new Set<number>();
    // One table pair at a time: only two full analyses are kept in memory.
    if (differ) for (const other of others) for (const id of await this.differIds(paytableId, other, coins)) union.add(id);
    const ids = [...union];
    const { key, analysis } = await this.game(paytableId, coins);
    registerTrainingAnalysis(key, analysis);
    const drill = generateHand({ analysisKey: key, onlyIds: ids.length ? ids : undefined, sampling: "real" });
    this.prepareFamily(analysis.familyId);
    return analyzeHandFast(drill.hand, analysis.valueVector, analysis.familyId);
  }
  async validateTraining(paytableId: string, coins: number, label: string) {
    const { key } = await this.game(paytableId, coins);
    if (!(await this.trainableLabels(paytableId, coins)).includes(label)) throw new Error("No hands have this optimal category at the selected bet.");
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
