import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { profileSchema } from "@perfect-draw/shared";
import { db } from "../data/db";
import { trainingService } from "../services/training";
import type { Card } from "./core";

/** Review cards, today's review for a game, and the daily cap, kept current as you play. */
export function useReview(familyId: string | null, keepGoing = false) {
  const [value, setValue] = useState<{ cards: Card[]; queue: Awaited<ReturnType<typeof trainingService.queue>>; cap: number } | null>(null);
  // Cards come due as time passes without any write: ask again every minute.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!familyId) { setValue(null); return; }
    const subscription = liveQuery(async () => {
      const [cards, queue, profile] = await Promise.all([trainingService.cards(), trainingService.queue(familyId, keepGoing), db.records("profile").get("local")]);
      return { cards: cards.filter(card => card.familyId === familyId), queue, cap: profileSchema.parse(profile).prefs.dailyReviewCap };
    }).subscribe({ next: setValue, error: () => setValue(null) });
    return () => subscription.unsubscribe();
  }, [familyId, keepGoing, tick]);
  return value;
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
