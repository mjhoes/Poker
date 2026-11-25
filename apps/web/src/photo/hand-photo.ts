import * as z from "zod/v4";
import { RANKS, SUITS } from "@perfect-draw/engine";

/*
 * Hand photos: the model reads the five cards (and HELD markers); we check there are five different, valid cards and
 * turn them into the app's card numbers. Doubtful cards are flagged for the player to correct.
 */

export const handReplySchema = z.object({
  readable: z.boolean(),
  cards: z.array(z.object({ rank: z.string(), suit: z.string(), confidence: z.number() })),
  /** One per card, left to right, when the machine shows HELD; else null. */
  held: z.array(z.boolean()).nullable(),
  payTableVisible: z.boolean(),
});
export type HandReply = z.infer<typeof handReplySchema>;

export const HAND_SYSTEM = [
  "You read video poker hands from photos of machines. Report exactly what is shown.",
  "",
  "- cards: the five dealt cards, left to right. rank: one of A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, 2. suit: one of",
  "  spades, hearts, diamonds, clubs. confidence: 0 to 1, how sure you are of that card.",
  "- held: if the machine marks cards as HELD, five true/false values left to right; otherwise null.",
  "- payTableVisible: true if the photo also shows the machine's pay table (rows of hands and pays).",
  "- readable: false if five cards can't be seen; then cards is empty.",
].join("\n");
export const HAND_PROMPT = "Read the five cards in this video poker photo.";

const RANK_WORDS: Record<string, string> = { ace: "A", king: "K", queen: "Q", jack: "J", ten: "10", t: "10" };
const SUIT_WORDS: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs", "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };

/** Card number (rank × 4 + suit) for a reported card, or null when it isn't a real card. */
export function cardFromReply(rank: string, suit: string): number | null {
  const r = (RANK_WORDS[rank.trim().toLowerCase()] ?? rank.trim().toUpperCase()).replace("10", "T");
  const s = SUIT_WORDS[suit.trim().toLowerCase()] ?? suit.trim().toLowerCase().replace(/s?$/, "s");
  const rankIndex = RANKS.indexOf(r), suitIndex = ["clubs", "diamonds", "hearts", "spades"].indexOf(s);
  if (r.length !== 1 || rankIndex < 0 || suitIndex < 0) return null;
  return rankIndex * 4 + SUITS.indexOf("cdhs"[suitIndex]);
}

export interface HandReading { cards: number[]; doubtful: number[]; heldMask: number | null; payTableVisible: boolean }

/** A problem with the reply worth one retry, or null. */
export function handProblem(reply: HandReply): string | null {
  if (!reply.readable) return null;
  if (reply.cards.length !== 5) return `Report exactly five cards; you reported ${reply.cards.length}.`;
  const cards = reply.cards.map(card => cardFromReply(card.rank, card.suit));
  if (cards.some(card => card === null)) return "Every card needs a rank (A, K, Q, J, 10–2) and a suit (spades, hearts, diamonds, clubs).";
  if (new Set(cards).size !== 5) return "Two cards were reported the same; a hand has five different cards.";
  return null;
}

const LOW_CONFIDENCE = 0.8;

export function readHand(reply: HandReply): HandReading {
  if (!reply.readable || handProblem(reply)) throw new Error("Couldn't read five cards in that photo. Try a closer, straighter shot.");
  const cards = reply.cards.map(card => cardFromReply(card.rank, card.suit) as number);
  const heldMask = reply.held && reply.held.length === 5 ? reply.held.reduce((mask, held, index) => held ? mask | (1 << index) : mask, 0) : null;
  return {
    cards, heldMask, payTableVisible: reply.payTableVisible,
    doubtful: reply.cards.flatMap((card, index) => card.confidence < LOW_CONFIDENCE ? [index] : []),
  };
}
