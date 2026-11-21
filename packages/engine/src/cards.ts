import type { Card, CardMask, Hand } from "./types";

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";
export const DECK_SIZE = 52;
export const JOKER = 52; // Reserved; no launch game accepts a joker.

export function assertCard(card: number): asserts card is Card {
  if (!Number.isInteger(card) || card < 0 || card >= DECK_SIZE) {
    throw new RangeError("Card must be an integer from 0 to 51; jokers are not supported.");
  }
}

export function cardRank(card: Card): number {
  assertCard(card);
  return Math.floor(card / 4);
}

export function cardSuit(card: Card): number {
  assertCard(card);
  return card % 4;
}

export function parseCard(text: string): Card {
  const match = /^(10|[2-9TJQKA])([cdhs])$/i.exec(text.trim());
  if (!match) throw new Error(`Invalid card: ${text}`);
  const rank = match[1].toUpperCase().replace("10", "T");
  return RANKS.indexOf(rank) * 4 + SUITS.indexOf(match[2].toLowerCase());
}

export function formatCard(card: Card): string {
  return RANKS[cardRank(card)] + SUITS[cardSuit(card)];
}

export function validateHand(cards: readonly Card[]): asserts cards is Hand {
  if (cards.length !== 5) throw new RangeError("A hand must contain exactly five cards.");
  for (const card of cards) assertCard(card);
  if (new Set(cards).size !== 5) throw new Error("A hand cannot contain duplicate cards.");
}

export function parseHand(text: string): Hand {
  const compact = text.replace(/[\s,]+/g, "");
  const tokens = compact.match(/(?:10|[2-9TJQKA])[cdhs]/gi) ?? [];
  if (tokens.join("").toLowerCase() !== compact.toLowerCase()) {
    throw new Error(`Invalid hand: ${text}`);
  }
  const cards = tokens.map(parseCard);
  validateHand(cards);
  return cards;
}

export function sortedHand(cards: readonly Card[]): Hand {
  validateHand(cards);
  return [...cards].sort((a, b) => a - b) as unknown as Hand;
}

export function toCardMask(cards: readonly Card[]): CardMask {
  let low = 0;
  let high = 0;
  for (const card of cards) {
    assertCard(card);
    if (card < 32) low |= 1 << card;
    else high |= 1 << (card - 32);
  }
  return [low >>> 0, high >>> 0];
}
