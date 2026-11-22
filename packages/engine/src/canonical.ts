import { validateHand } from "./cards";
import type { Card, Hand } from "./types";

const SUIT_PERMUTATIONS: readonly number[][] = (() => {
  const result: number[][] = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++)
    for (let c = 0; c < 4; c++) for (let d = 0; d < 4; d++) {
      if (new Set([a, b, c, d]).size === 4) result.push([a, b, c, d]);
    }
  return result;
})();

/** Five six-bit card integers; numeric order is lexicographic sorted-hand order. */
export function packHand(cards: readonly Card[]): number {
  return cards[0] * 16777216 + cards[1] * 262144 + cards[2] * 4096 + cards[3] * 64 + cards[4];
}

export function unpackHand(id: number): Hand {
  if (!Number.isInteger(id) || id < 0 || id >= 2 ** 30) throw new RangeError("Invalid canonical hand ID.");
  const hand = [(id >>> 24) & 63, (id >>> 18) & 63, (id >>> 12) & 63, (id >>> 6) & 63, id & 63];
  validateHand(hand);
  if (hand.some((card, i) => i > 0 && card <= hand[i - 1])) throw new Error("Hand ID must encode sorted cards.");
  return hand;
}

function permute(cards: readonly Card[], suits: readonly number[]): number[] {
  return cards.map(card => (card & ~3) + suits[card & 3]).sort((a, b) => a - b);
}

export interface CanonicalHand {
  readonly id: number;
  readonly hand: Hand;
  /** Number of actual starting hands in this suit orbit. */
  readonly weight: number;
}

export interface CanonicalizedHand extends CanonicalHand {
  /** canonical index -> original input position (remaps hold masks safely). */
  readonly canonicalToOriginal: readonly number[];
}

export function canonicalizeHand(cards: readonly Card[]): CanonicalizedHand {
  validateHand(cards);
  let id = Infinity;
  let bestSuits = SUIT_PERMUTATIONS[0];
  let hand = [...cards] as unknown as Hand;
  const orbit = new Set<number>();
  for (const suits of SUIT_PERMUTATIONS) {
    const candidate = permute(cards, suits) as unknown as Hand;
    const key = packHand(candidate);
    orbit.add(key);
    if (key < id) { id = key; hand = candidate; bestSuits = suits; }
  }
  const canonicalToOriginal = hand.map(card =>
    cards.findIndex(original => (original & ~3) + bestSuits[original & 3] === card),
  );
  return { id, hand, weight: orbit.size, canonicalToOriginal };
}

export function restoreHoldMask(mask: number, canonicalToOriginal: readonly number[]): number {
  if (!Number.isInteger(mask) || mask < 0 || mask > 31 ||
      canonicalToOriginal.length !== 5 || new Set(canonicalToOriginal).size !== 5 ||
      canonicalToOriginal.some(i => !Number.isInteger(i) || i < 0 || i > 4)) {
    throw new RangeError("Invalid mask or card-position mapping.");
  }
  let result = 0;
  for (let i = 0; i < 5; i++) if (mask & (1 << i)) result |= 1 << canonicalToOriginal[i];
  return result;
}

let canonicalHands: readonly CanonicalHand[] | undefined;

export function getCanonicalHands(): readonly CanonicalHand[] {
  if (canonicalHands) return canonicalHands;
  const result: CanonicalHand[] = [];
  // Only first-occurrence-normalized suit sequences can be minimal. This
  // inexpensive filter avoids 24 suit permutations for most actual hands.
  for (let a = 0; a < 48; a += 4)
    for (let b = a + 1; b < 49; b++)
      for (let c = b + 1; c < 50; c++)
        for (let d = c + 1; d < 51; d++)
          for (let e = d + 1; e < 52; e++) {
            const hand = [a, b, c, d, e] as unknown as Hand;
            let next = 0;
            let allowed = true;
            for (let i = 0; i < 5; i++) {
              const suit = hand[i] & 3;
              if (suit > next) { allowed = false; break; }
              if (suit === next) next++;
            }
            if (!allowed) continue;
            const canonical = canonicalizeHand(hand);
            if (canonical.id === packHand(hand)) {
              result.push(Object.freeze({ id: canonical.id, hand: Object.freeze([...hand]) as unknown as Hand, weight: canonical.weight }));
            }
          }
  if (result.length !== 134459 || result.reduce((sum, hand) => sum + hand.weight, 0) !== 2598960) {
    throw new Error("Suit-isomorphism enumeration failed its count/weight invariants.");
  }
  canonicalHands = Object.freeze(result);
  return canonicalHands;
}
