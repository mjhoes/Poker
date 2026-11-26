import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { profileSchema } from "@perfect-draw/shared";
import { db } from "../data/db";
import { trainingService } from "../services/training";
import type { Card } from "./core";
import type { TrainingTable } from "../services/training";
import { errorMessage } from "../hooks/useActionRunner";

/** Review cards, today's review on a table, and the daily cap, kept current as you play. */
export function useReview(table: TrainingTable | null, keepGoing = false) {
  const [value, setValue] = useState<{ cards: Card[]; queue: Awaited<ReturnType<typeof trainingService.queue>>; cap: number } | null>(null);
  // Cards come due as time passes without any write: ask again every minute.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!table) { setValue(null); return; }
    const subscription = liveQuery(async () => {
      const [cards, queue, profile] = await Promise.all([trainingService.cards(), trainingService.queue(table, keepGoing), db.records("profile").get("local")]);
      return { cards: cards.filter(card => card.familyId === table.familyId), queue, cap: profileSchema.parse(profile).prefs.dailyReviewCap };
    }).subscribe({ next: setValue, error: () => setValue(null) });
    return () => subscription.unsubscribe();
  }, [table, keepGoing, tick]);
  return value;
}

/**
 * A table at a bet for review: its game and the categories it can deal (read from the engine, so outside liveQuery,
 * which only follows database reads).
 */
export function useTrainingTable(paytableId: string | undefined, coins: number | undefined) {
  const [value, setValue] = useState<{ key: string; table?: TrainingTable; error?: string } | null>(null);
  const key = paytableId && coins ? `${paytableId}:${coins}` : "";
  useEffect(() => {
    if (!paytableId || !coins) { setValue(null); return; }
    let cancelled = false;
    setValue({ key });
    trainingService.table(paytableId, coins).then(table => { if (!cancelled) setValue({ key, table }); },
      reason => { if (!cancelled) setValue({ key, error: errorMessage(reason) }); });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the key names both inputs
  return value?.key === key ? value : null;
}

/** The game family of a pay table. */
export function useFamily(paytableId: string | undefined) {
  const [familyId, setFamilyId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!paytableId) { setFamilyId(null); return; }
    void trainingService.familyOf(paytableId).then(value => { if (!cancelled) setFamilyId(value); }, () => { if (!cancelled) setFamilyId(null); });
    return () => { cancelled = true; };
  }, [paytableId]);
  return familyId;
}
