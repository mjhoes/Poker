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

const returnCache = new Map<string, Promise<ReturnInfo>>();
/**
 * The return expected from play on a pay table at a bet: the table's optimal return, and yours after the mistakes
 * measured in practice on that table (only with at least 200 practice decisions; otherwise optimal, marked unmeasured).
 */
export function expectedReturn(paytableId: string, coins: number): Promise<ReturnInfo> {
  const key = `${paytableId}:${coins}`;
  let pending = returnCache.get(key);
  if (!pending) {
    pending = (async () => {
      const optimalPct = (await engineClient().tableSummary(paytableId, coins)).returnPct;
      const recent = await db.records("decisions").where("paytableId").equals(paytableId).filter(row => row.coins === coins && !row.isCorrection && row.deletedAt == null).count();
      const archived = (await db.records("dailyAggregates").where("paytableId").equals(paytableId).toArray()).filter(row => row.coins === coins && row.deletedAt == null).reduce((sum, row) => sum + row.n, 0);
      if (recent + archived < MIN_DECISIONS_FOR_ERROR_COST) return { optimalPct, effectivePct: optimalPct, measured: false };
      const report = await statsService.report({ paytableId, coins: coins as 1 | 2 | 3 | 4 | 5, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      const effective = report.realPlayWeightedReturnPct ?? report.realPlayWeightedEstimatePct ?? report.asDrilledReturnPct;
      return effective === null ? { optimalPct, effectivePct: optimalPct, measured: false } : { optimalPct, effectivePct: Math.min(optimalPct, effective), measured: true };
    })();
    pending.catch(() => returnCache.delete(key));
    returnCache.set(key, pending);
  }
  return pending;
}

/** Expected returns for every (pay table, coins) pair asked for; a pair that fails is simply missing. */
export function useExpectedReturns(pairs: readonly { paytableId?: string; coins: number }[]) {
  const keys = [...new Set(pairs.filter(pair => pair.paytableId).map(pair => `${pair.paytableId}:${pair.coins}`))].sort();
  const signature = keys.join("|");
  const [settled, setSettled] = useState<{ signature: string; values: ReadonlyMap<string, ReturnInfo> }>({ signature: "", values: new Map() });
  useEffect(() => {
    let cancelled = false;
    void Promise.all(keys.map(async key => {
      const [paytableId, coins] = key.split(":");
      try { return [key, await expectedReturn(paytableId, Number(coins))] as const; } catch { return null; }
    })).then(entries => {
      if (!cancelled) setSettled({ signature, values: new Map(entries.filter((entry): entry is readonly [string, ReturnInfo] => entry !== null)) });
    });
    return () => { cancelled = true; };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps -- the signature lists the pairs
  // Until the current pairs settle, keep showing what was known (a pair that failed stays missing once ready).
  return { get: (key: string) => settled.values.get(key), ready: settled.signature === signature };
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
