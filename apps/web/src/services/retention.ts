import { aggregateStatistics, gradeDecision, localDay } from "@perfect-draw/engine";
import type { GameAnalysis, StatsObservation } from "@perfect-draw/engine";
import { decisionSchema, newId, recordSchemas, sessionSchema } from "@perfect-draw/shared";
import type { Records } from "@perfect-draw/shared";
import { db, live, stamp } from "../data/db";

export const RAW_DECISION_RETENTION_DAYS = 90;
export async function countDecisions() {
  return db.transaction("r", [db.records("decisions"), db.records("dailyAggregates")], async () => {
    const [raw, archived] = await Promise.all([db.records("decisions").count(), db.records("dailyAggregates").toArray()]);
    return raw + archived.reduce((sum, row) => sum + row.n + row.excludedCorrections, 0);
  });
}
/** Resolve analyses outside the transaction; all aggregate writes and raw deletion
 * commit together. A failed/changed snapshot leaves every raw record intact. */
export async function rollupDecisions(timeZone: string,
  resolve: (table: string, coins: number) => Promise<{ key: string; analysis: GameAnalysis }>, now = Date.now()) {
  localDay(now, timeZone);
  const raw = await db.records("decisions").where("createdAt").below(now - RAW_DECISION_RETENTION_DAYS * 86_400_000).toArray();
  if (!raw.length) return 0;
  const sessions = new Map((await db.records("sessions").toArray()).map(row => [row.id, sessionSchema.parse(row)]));
  const groups = new Map<string, Records["decisions"][]>();
  for (const row of raw.filter(live)) {
    const decision = decisionSchema.parse(row), session = sessions.get(decision.sessionId);
    if (!session || !live(session)) continue;
    if (decision.variantKind !== "standard") throw new Error("Unsupported historical variant; raw history has been retained.");
    const key = JSON.stringify([decision.paytableId, decision.coins, decision.analysisKey, session.mode]);
    const group = groups.get(key) ?? []; group.push(decision); groups.set(key, group);
  }
  const prepared: Records["dailyAggregates"][] = [];
  for (const group of groups.values()) {
    const first = group[0], session = sessions.get(first.sessionId)!;
    const { key, analysis } = await resolve(first.paytableId, first.coins);
    if (key !== first.analysisKey) throw new Error("Historical engine version cannot be safely summarized; raw history has been retained.");
    const ranges = new Map<string, { firstAt: number; lastAt: number }>();
    const observations: StatsObservation[] = group.map(decision => {
      if (sessions.get(decision.sessionId)!.machineSnapshot.coins !== decision.coins) throw new Error("Historical bet mismatch; raw history has been retained.");
      const canonical = analysis.perHand.get(decision.canonicalHandId);
      if (!canonical) throw new Error("Historical canonical hand is missing; raw history has been retained.");
      const bucket = JSON.stringify([localDay(decision.createdAt, timeZone), canonical.bestLabel, decision.chosenLabel]);
      const range = ranges.get(bucket);
      ranges.set(bucket, { firstAt: Math.min(range?.firstAt ?? decision.createdAt, decision.createdAt), lastAt: Math.max(range?.lastAt ?? decision.createdAt, decision.createdAt) });
      return { bestLabel: canonical.bestLabel, chosenLabel: decision.chosenLabel, evLoss: decision.evLoss, createdAt: decision.createdAt, isCorrection: decision.isCorrection };
    });
    for (const stats of aggregateStatistics(observations, timeZone)) {
      const bucketKey = JSON.stringify([stats.day, first.paytableId, first.coins, first.variantKind, stats.bestLabel, stats.chosenLabel, key, session.mode, timeZone]);
      prepared.push(recordSchemas.dailyAggregates.parse({
        id: newId(), ...stamp(), ...stats, bucketKey, timeZone, paytableId: first.paytableId,
        analysisKey: key, coins: first.coins, variantKind: first.variantKind, mode: session.mode,
        ...ranges.get(JSON.stringify([stats.day, stats.bestLabel, stats.chosenLabel])),
      }));
    }
  }
  await db.transaction("rw", [db.records("dailyAggregates"), db.records("decisions"), db.records("sessions")], async () => {
    const current = await db.records("decisions").bulkGet(raw.map(row => row.id));
    if (current.some((row, i) => JSON.stringify(row) !== JSON.stringify(raw[i]))) throw new Error("History changed during retention; retry. No records were deleted.");
    for (const id of new Set(raw.map(row => row.sessionId))) {
      const before = sessions.get(id), after = await db.records("sessions").get(id);
      if (!before || !after || before.mode !== after.mode || before.machineSnapshot.coins !== after.machineSnapshot.coins || live(before) !== live(after)) throw new Error("Session terms changed during retention; retry.");
      const primary = raw.find(row => row.id === after.state.handId);
      if (primary && after.state.phase === "holding" && !after.state.primaryGrade) {
        if (!after.state.analysis) throw new Error("Pending round analysis is missing; raw history has been retained.");
        await db.records("sessions").put({ ...after, state: { ...after.state, primaryGrade: gradeDecision(after.state.analysis, primary.chosenMask, after.mode === "drill" ? 1 : after.machineSnapshot.lines) } });
      }
    }
    for (const row of prepared) {
      const previous = await db.records("dailyAggregates").where("bucketKey").equals(row.bucketKey).first();
      if (!previous) await db.records("dailyAggregates").add(row);
      else {
        const combined = { ...row, id: previous.id, firstAt: Math.min(row.firstAt, previous.firstAt), lastAt: Math.max(row.lastAt, previous.lastAt) };
        for (const field of ["n", "errors", "evLostTotal", "weightedN", "weightedErrors", "weightedEvLost", "excludedCorrections"] as const) combined[field] += previous[field];
        await db.records("dailyAggregates").put(recordSchemas.dailyAggregates.parse(combined));
      }
    }
    await db.records("decisions").bulkDelete(raw.map(row => row.id));
  });
  return raw.length;
}
