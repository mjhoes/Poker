import { describeHoldUnchecked } from "./labels";
import type { HoldPattern } from "./labels";
import type { Card, GameFamilyId } from "./types";

export const CHART_TIE_RULE =
  "Fewest total penalty cards; ties: fewer flush penalties, fewer straight penalties, fewer held cards, then higher ranks. For suit ties, compare each suit's dealt ranks from highest to lowest. Identical suit patterns are interchangeable. Never compare EV.";

/** Diagnostic unnamed patterns are not playable/printable chart categories. */
export function isChartLabel(label: string): boolean {
  if (label.includes(" / ")) return label.split(" / ").every(isChartLabel);
  return !/(?:^|_)OTHER_\d/.test(label) && !/(?:^|_)HIGH_CARD(?:[|]|$)/.test(label);
}

/** Larger is preferred. Depends only on visible cards, never payouts or EV. */
export function holdPreference(pattern: HoldPattern): number {
  let ranks = 0;
  for (let i = 0; i < pattern.heldRanks.length; i++) ranks += ("23456789TJQKA".indexOf(pattern.heldRanks[i]) + 1) * 14 ** (4 - i);
  return ((((10 - pattern.flushPenalty - pattern.straightPenalty) * 6 + 5 - pattern.flushPenalty) * 6 +
    5 - pattern.straightPenalty) * 6 + 5 - pattern.heldRanks.length) * 14 ** 5 + ranks;
}

export function canonicalMaskOrder(cards: readonly Card[]): number[] {
  const suitRanks = [0, 0, 0, 0];
  for (const card of cards) suitRanks[card & 3] |= 1 << (card >> 2);
  const suits = [0, 1, 2, 3].sort((a, b) => suitRanks[b] - suitRanks[a] || a - b);
  const canonicalToOriginal = cards.map((card, original) => ({ original, key: (card >> 2) * 4 + suits.indexOf(card & 3) }))
    .sort((a, b) => a.key - b.key).map(card => card.original);
  return Array.from({ length: 32 }, (_, mask) => canonicalToOriginal.reduce((out, original, canonical) =>
    out | ((mask & (1 << original)) ? 1 << canonical : 0), 0));
}

export function preferHold(cards: readonly Card[], candidate: number, current: number, familyId: GameFamilyId): boolean {
  if (current < 0) return true;
  const a = holdPreference(describeHoldUnchecked(cards, candidate, familyId));
  const b = holdPreference(describeHoldUnchecked(cards, current, familyId));
  if (a !== b) return a > b;
  const order = canonicalMaskOrder(cards);
  return order[candidate] < order[current];
}
