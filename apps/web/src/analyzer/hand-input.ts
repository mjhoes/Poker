import { RANKS, SUITS } from "@perfect-draw/engine";
import { cardName } from "../table/cards";

/*
 * Typing a hand: "As Ks Qd 7c 2h", "AsKsQd7c2h", "10h", "Th", suit symbols, any case, commas. Partial input is fine
 * while typing; `complete` says whether there are exactly five valid, distinct cards.
 */
const SYMBOLS: Record<string, string> = { "♣": "c", "♦": "d", "♥": "h", "♠": "s" };
const TOKEN = /(10|[2-9tjqka])([cdhs])/iy;

export type HandText = { cards: number[]; complete: boolean; error: string | null };

export function cardFrom(rank: string, suit: string) {
  return RANKS.indexOf(rank.toUpperCase().replace("10", "T")) * 4 + SUITS.indexOf(suit.toLowerCase());
}
export function cardCode(card: number) { return `${RANKS[Math.floor(card / 4)]}${SUITS[card % 4]}`; }
export function handCode(cards: readonly number[]) { return cards.map(cardCode).join(""); }
export function handText(cards: readonly number[]) { return cards.map(cardCode).join(" "); }

export function readHandText(text: string): HandText {
  const compact = text.replace(/[♣♦♥♠]/g, symbol => SYMBOLS[symbol]).replace(/[\s,]+/g, "");
  const cards: number[] = [];
  let index = 0;
  while (index < compact.length) {
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(compact);
    if (!match) {
      const rest = compact.slice(index);
      // A lone rank at the end is a card still being typed.
      if (/^(10?|[2-9tjqka])$/i.test(rest)) return { cards, complete: false, error: null };
      return { cards, complete: false, error: `“${rest.slice(0, 3)}” is not a card. Use a rank (2–10, J, Q, K, A) then a suit (c, d, h, s).` };
    }
    const card = cardFrom(match[1], match[2]);
    if (cards.includes(card)) return { cards, complete: false, error: `Two cards are the ${cardName(card)}.` };
    cards.push(card);
    index = TOKEN.lastIndex;
  }
  if (cards.length > 5) return { cards: cards.slice(0, 5), complete: false, error: `That's ${cards.length} cards; a hand has five.` };
  return { cards, complete: cards.length === 5, error: null };
}

/** What the analyzer's address holds: `#/analyze?hand=AsKsQd7c2h&table=<id>&bet=5&held=3`. */
export interface AnalyzerQuery {
  hand: number[] | null; paytableId: string | null; coins: number | null; held: number | null;
  /** The address named a table (valid or not); with `paytableId` null it was malformed. */ tableRequested: boolean;
}

export function encodeAnalyzerQuery(query: { hand: readonly number[]; paytableId: string; coins: number; held?: number | null }) {
  const params = new URLSearchParams({ hand: handCode(query.hand), table: query.paytableId, bet: String(query.coins) });
  if (query.held !== undefined && query.held !== null) params.set("held", String(query.held));
  return params.toString();
}

export function decodeAnalyzerQuery(search: string): AnalyzerQuery {
  const params = new URLSearchParams(search);
  const read = readHandText(params.get("hand") ?? "");
  const coins = Number(params.get("bet"));
  const held = params.get("held");
  const heldMask = held !== null && /^\d+$/.test(held) ? Number(held) : null;
  const table = params.get("table");
  return {
    hand: read.complete ? read.cards : null,
    paytableId: table && /^[a-f0-9]{64}$/.test(table) ? table : null,
    coins: Number.isInteger(coins) && coins >= 1 && coins <= 5 ? coins : null,
    held: heldMask !== null && heldMask >= 0 && heldMask <= 31 ? heldMask : null,
    tableRequested: table !== null,
  };
}

/** Five distinct random cards. */
export function randomHand(random: () => number = Math.random) {
  const cards: number[] = [];
  while (cards.length < 5) {
    const card = Math.floor(random() * 52);
    if (!cards.includes(card)) cards.push(card);
  }
  return cards;
}
