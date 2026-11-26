import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import type { AiProvider } from "@perfect-draw/shared";
import { useAiStore } from "../ai/store";
import type { MnemonicStyle } from "../ai/heuristics-ai";
import { heuristicService } from "../services/heuristics";
import type { HeuristicCard } from "../services/heuristics";
import { trainingService } from "../services/training";
import { graduated } from "../training/core";

/** Every live heuristic card, and which ones' best-hold category you've mastered (round A cards), kept current. */
export function useHeuristicCards() {
  const [value, setValue] = useState<{ cards: HeuristicCard[]; mastered: Set<string> } | null>(null);
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [cards, mastery] = await Promise.all([heuristicService.cards(), trainingService.cards()]);
      const graduatedLabels = mastery.filter(graduated).map(card => card.label);
      // A card's best hold is a category or one variant of it; it's mastered when every card of that kind you have is.
      const mastered = new Set(cards.filter(card => {
        const label = card.targetLabelPair[0];
        const mine = mastery.filter(row => row.label === label || row.label.split("|")[0] === label);
        return mine.length > 0 && mine.every(row => graduatedLabels.includes(row.label));
      }).map(card => card.id));
      return { cards, mastered };
    }).subscribe({ next: setValue, error: () => setValue({ cards: [], mastered: new Set() }) });
    return () => subscription.unsubscribe();
  }, []);
  return value;
}

/** The provider and model size AI heuristics use: the chosen heuristics provider when its key is set, else the other. */
export function useHeuristicsAi() {
  const settings = useAiStore(state => state.settings);
  const keys = useAiStore(state => state.keys);
  const available = (["anthropic", "openai"] as AiProvider[]).filter(provider => !!keys[provider]);
  const preferred = settings?.heuristicsProvider ?? "anthropic";
  return {
    provider: available.includes(preferred) ? preferred : available[0] ?? null,
    tier: settings?.coachTier ?? "heavy",
    style: (settings?.mnemonicStyle ?? "phrase") as MnemonicStyle,
  };
}

/** The hold categories a rule can name on a table at a bet, with their names (an engine call). */
export function useCategories(paytableId: string | undefined, coins: number | undefined) {
  const [value, setValue] = useState<{ key: string; codes?: string[]; error?: string } | null>(null);
  const key = paytableId && coins ? `${paytableId}:${coins}` : "";
  useEffect(() => {
    if (!paytableId || !coins) { setValue(null); return; }
    let cancelled = false;
    setValue({ key });
    heuristicService.categories(paytableId, coins).then(codes => { if (!cancelled) setValue({ key, codes }); },
      reason => { if (!cancelled) setValue({ key, error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the key names both inputs
  return value?.key === key ? value : null;
}
