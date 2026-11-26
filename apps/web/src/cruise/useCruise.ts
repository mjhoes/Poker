import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../data/db";
import { casinoService, practicePaceNow, programService, rewardService, tripService } from "../services/cruise";
import { statsService } from "../services/statistics";
import { engineClient } from "../worker/client";
import { MIN_DECISIONS_FOR_ERROR_COST } from "./economics";
import type { CasinoSession, Program, ReturnInfo, Reward, Trip } from "./economics";

export type CruiseData = { ready: boolean; error: string; programs: Program[]; trips: Trip[]; sessions: CasinoSession[]; rewards: Reward[] };

/** Programs, trips, casino sessions and rewards, kept current as they change. */
export function useCruiseData(): CruiseData {
  const [data, setData] = useState<CruiseData>({ ready: false, error: "", programs: [], trips: [], sessions: [], rewards: [] });
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [programs, trips, sessions, rewards] = await Promise.all([programService.list(), tripService.list(), casinoService.list(), rewardService.list()]);
      return { programs, trips, sessions, rewards };
    }).subscribe({
      next: value => setData({ ...value, ready: true, error: "" }),
      error: reason => setData(previous => ({ ...previous, ready: true, error: String(reason) })),
    });
    return () => subscription.unsubscribe();
  }, []);
  return data;
}

/** A re-render every `ms` while `active` (for a running timer). */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
  return now;
}

/** Practice on a table at a bet: how many decisions count, and a version that changes whenever they do. */
export async function practiceOn(paytableId: string, coins: number) {
  const decisions = (await db.records("decisions").where("paytableId").equals(paytableId).toArray()).filter(row => row.coins === coins);
  const archived = (await db.records("dailyAggregates").where("paytableId").equals(paytableId).toArray()).filter(row => row.coins === coins);
  const counted = decisions.filter(row => row.deletedAt == null && !row.isCorrection).length
    + archived.filter(row => row.deletedAt == null).reduce((sum, row) => sum + row.n, 0);
  const latest = Math.max(0, ...decisions.map(row => row.updatedAt), ...archived.map(row => row.updatedAt));
  const newestId = [...decisions, ...archived].reduce((max, row) => row.id > max ? row.id : max, "");
  // Rows added, changed, deleted or archived all change the version (ids are unique, so replaced data does too).
  return { counted, version: `${decisions.length}:${archived.length}:${counted}:${latest}:${newestId}` };
}

const optimalCache = new Map<string, Promise<number>>();
const returnCache = new Map<string, Promise<ReturnInfo>>();
function cached<T>(cache: Map<string, Promise<T>>, key: string, work: () => Promise<T>) {
  let pending = cache.get(key);
  if (!pending) {
    pending = work();
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}
/**
 * The return expected from play on a pay table at a bet: the table's optimal return, and yours after the mistakes
 * measured in practice there. Mistakes count only when Statistics can stand behind them for real play: "measured"
 * when practice covers every kind of deal, "estimated" when it covers at least 99% (the rest imputed from your average
 * mistake). With fewer than 200 decisions or less coverage, it is the optimal return, saying why. A drill-weighted
 * figure is never used: drills over-sample the hands being trained. Results are kept per practice version, so new
 * practice, archiving or deleted history is picked up.
 */
export async function expectedReturn(paytableId: string, coins: number, practice?: Awaited<ReturnType<typeof practiceOn>>): Promise<ReturnInfo> {
  const current = practice ?? await practiceOn(paytableId, coins);
  return cached(returnCache, `${paytableId}:${coins}:${current.version}`, async () => {
    const optimalPct = await cached(optimalCache, `${paytableId}:${coins}`, async () => (await engineClient().tableSummary(paytableId, coins)).returnPct);
    if (current.counted < MIN_DECISIONS_FOR_ERROR_COST) return { optimalPct, effectivePct: optimalPct, basis: "optimal", reason: "few-decisions" };
    const report = await statsService.report({ paytableId, coins: coins as 1 | 2 | 3 | 4 | 5, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (report.realPlayWeightedReturnPct !== null) return { optimalPct, effectivePct: Math.min(optimalPct, report.realPlayWeightedReturnPct), basis: "measured", coverage: report.frequencyCoverage };
    if (report.realPlayWeightedEstimatePct !== null) {
      return { optimalPct, effectivePct: Math.min(optimalPct, report.realPlayWeightedEstimatePct), basis: "estimated", coverage: report.frequencyCoverage, imputedShare: report.imputedFrequencyShare };
    }
    return { optimalPct, effectivePct: optimalPct, basis: "optimal", reason: "low-coverage", coverage: report.frequencyCoverage };
  });
}

/**
 * Expected returns for every (pay table, coins) pair asked for, kept current as practice changes (a live query on the
 * practice versions); a pair that fails is simply missing.
 */
export function useExpectedReturns(pairs: readonly { paytableId?: string; coins: number }[]) {
  const keys = [...new Set(pairs.filter(pair => pair.paytableId).map(pair => `${pair.paytableId}:${pair.coins}`))].sort();
  const signature = keys.join("|");
  const [versions, setVersions] = useState<{ signature: string; list: Awaited<ReturnType<typeof practiceOn>>[] } | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => Promise.all(keys.map(key => {
      const [paytableId, coins] = key.split(":");
      return practiceOn(paytableId, Number(coins));
    }))).subscribe({ next: list => setVersions({ signature, list }), error: () => setVersions({ signature, list: [] }) });
    return () => subscription.unsubscribe();
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps -- the signature lists the pairs
  const current = versions?.signature === signature ? versions.list : null;
  const versionSignature = current ? `${signature}#${current.map(item => item.version).join("|")}` : "";
  const [settled, setSettled] = useState<{ signature: string; values: ReadonlyMap<string, ReturnInfo> }>({ signature: "", values: new Map() });
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    void Promise.all(keys.map(async (key, index) => {
      const [paytableId, coins] = key.split(":");
      try { return [key, await expectedReturn(paytableId, Number(coins), current[index])] as const; } catch { return null; }
    })).then(entries => {
      if (!cancelled) setSettled({ signature: versionSignature, values: new Map(entries.filter((entry): entry is readonly [string, ReturnInfo] => entry !== null)) });
    });
    return () => { cancelled = true; };
  }, [versionSignature]); // eslint-disable-line react-hooks/exhaustive-deps -- the signature covers the pairs and their practice
  // Until the current pairs settle, keep showing what was known (a pair that failed stays missing once ready).
  return { get: (key: string) => settled.values.get(key), ready: versionSignature !== "" && settled.signature === versionSignature };
}
export const returnKey = (paytableId: string | undefined, coins: number) => paytableId ? `${paytableId}:${coins}` : "";

/** Hands per active hour in Free Play, or null with too little practice. */
export function usePracticePace() {
  const [pace, setPace] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void practicePaceNow().then(value => { if (!cancelled) setPace(value.handsPerHour); }, () => undefined);
    return () => { cancelled = true; };
  }, []);
  return pace;
}
