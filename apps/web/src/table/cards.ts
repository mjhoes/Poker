import { cardRank, cardSuit } from "@perfect-draw/engine";

export const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const SUIT_NAMES = ["clubs", "diamonds", "hearts", "spades"] as const;
export type SuitName = typeof SUIT_NAMES[number];

export const rankLabel = (card: number) => RANK_LABELS[cardRank(card)];
export const suitName = (card: number): SuitName => SUIT_NAMES[cardSuit(card)];
export const cardName = (card: number) => `${rankLabel(card)} of ${suitName(card)}`;
const SUIT_SYMBOLS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const;
/** "10♠" — compact text for naming a hold in a list. */
export const shortCard = (card: number) => `${rankLabel(card)}${SUIT_SYMBOLS[suitName(card)]}`;
export const maskIndexes = (mask: number) => [0, 1, 2, 3, 4].filter(index => (mask & (1 << index)) !== 0);

const DEUCE = 0;
const JACK = 9;
/** Hands whose value comes from all five cards (including quads with a paying kicker). */
const WHOLE_HAND = new Set([
  "ROYAL_FLUSH", "NATURAL_ROYAL", "WILD_ROYAL", "STRAIGHT_FLUSH", "FIVE_KIND", "FULL_HOUSE", "FLUSH", "STRAIGHT",
  "FOUR_ACES_W_234", "FOUR_234_W_A234",
]);

/**
 * Bit mask of the cards that make a final hand's paying combination, for highlighting a win: all five for straights,
 * flushes and full houses; the matched ranks for pairs, trips and quads; wild deuces count toward the made hand.
 * Display only — payouts always come from the engine.
 */
export function winningMask(hand: readonly number[], rank: string, familyId: string): number {
  if (rank === "NOTHING" || hand.length !== 5) return 0;
  if (WHOLE_HAND.has(rank)) return 0b11111;
  const wild = familyId === "deuces_wild";
  const ranks = hand.map(card => cardRank(card));
  const counts = new Map<number, number>();
  ranks.forEach(value => { if (!(wild && value === DEUCE)) counts.set(value, (counts.get(value) ?? 0) + 1); });
  const toMask = (keep: (value: number) => boolean) => ranks.reduce((mask, value, index) => keep(value) ? mask | (1 << index) : mask, 0);
  if (rank === "FOUR_DEUCES") return toMask(value => value === DEUCE);
  if (wild) {
    // Deuces join the most common natural rank (ties go to the higher rank).
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    return toMask(value => value === DEUCE || value === best?.[0]);
  }
  if (rank === "TWO_PAIR") return toMask(value => counts.get(value) === 2);
  if (rank === "JACKS_OR_BETTER") return toMask(value => counts.get(value) === 2 && value >= JACK);
  if (rank === "THREE_KIND") return toMask(value => counts.get(value) === 3);
  if (rank.startsWith("FOUR_")) return toMask(value => counts.get(value) === 4);
  return 0b11111;
}
