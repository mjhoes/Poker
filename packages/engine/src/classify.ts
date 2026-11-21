import type { GameFamily, HandRankId } from "./types";

// Ten ordinary straight windows, including A2345. Ace cannot wrap K-A-2.
const STRAIGHTS = [0x100f, ...Array.from({ length: 9 }, (_, i) => 31 << i)];
const ROYAL = 31 << 8;

/** Reuses scratch memory during lookup-table construction. */
export function createClassifier(family: GameFamily): (a: number, b: number, c: number, d: number, e: number) => HandRankId {
  const counts = new Uint8Array(13);
  const wildCache = new Map<number, HandRankId>();
  const powers = Array.from({ length: 13 }, (_, i) => 5 ** i);

  return (a, b, c, d, e) => {
    counts.fill(0);
    const cards = [a, b, c, d, e];
    let bits = 0;
    let flush = true;
    let naturalSuit = -1;
    let wilds = 0;
    let pattern = 0;
    for (let i = 0; i < 5; i++) {
      const card = cards[i];
      const rank = card >> 2;
      if (family.wilds === "deuces" && rank === 0) {
        wilds++;
        continue;
      }
      counts[rank]++;
      bits |= 1 << rank;
      pattern += powers[rank];
      if (naturalSuit < 0) naturalSuit = card & 3;
      else if ((card & 3) !== naturalSuit) flush = false;
    }

    if (family.wilds === "deuces") {
      const key = pattern * 2 + Number(flush);
      const cached = wildCache.get(key);
      if (cached !== undefined) return cached;
      let result: HandRankId;
      let max = 0;
      for (let rank = 1; rank < 13; rank++) max = Math.max(max, counts[rank]);
      const royal = flush && (bits & ~ROYAL) === 0;
      const straight = STRAIGHTS.some(window => (bits & ~window) === 0 &&
        // Distinct natural ranks are necessary: a wild cannot remove a pair.
        popcount(bits) + wilds === 5);
      if (wilds === 0 && royal) result = "NATURAL_ROYAL";
      else if (wilds === 4) result = "FOUR_DEUCES";
      else if (royal) result = "WILD_ROYAL";
      else if (max + wilds >= 5) result = "FIVE_KIND";
      else if (flush && straight) result = "STRAIGHT_FLUSH";
      else if (max + wilds >= 4) result = "FOUR_KIND";
      else if (canMakeFullHouse(counts, wilds)) result = "FULL_HOUSE";
      else if (flush) result = "FLUSH";
      else if (straight) result = "STRAIGHT";
      else if (max + wilds >= 3) result = "THREE_KIND";
      else result = "NOTHING";
      wildCache.set(key, result);
      return result;
    }

    const straight = STRAIGHTS.includes(bits);
    if (flush && bits === ROYAL) return "ROYAL_FLUSH";
    if (flush && straight) return "STRAIGHT_FLUSH";
    let quad = -1;
    let triple = false;
    let pairs = 0;
    let pairRank = -1;
    let kicker = -1;
    for (let rank = 0; rank < 13; rank++) {
      if (counts[rank] === 4) quad = rank;
      else if (counts[rank] === 3) triple = true;
      else if (counts[rank] === 2) { pairs++; pairRank = rank; }
      else if (counts[rank] === 1) kicker = rank;
    }
    if (quad >= 0) {
      if (family.id === "jacks_or_better" || family.id === "bonus_poker_deluxe") return "FOUR_KIND";
      if (family.rankRules?.quadKickers) {
        if (quad === 12 && kicker <= 2) return "FOUR_ACES_W_234";
        if (quad <= 2 && (kicker <= 2 || kicker === 12)) return "FOUR_234_W_A234";
      }
      return quad === 12 ? "FOUR_ACES" : quad <= 2 ? "FOUR_234" : "FOUR_5K";
    }
    if (triple && pairs) return "FULL_HOUSE";
    if (flush) return "FLUSH";
    if (straight) return "STRAIGHT";
    if (triple) return "THREE_KIND";
    if (pairs === 2) return "TWO_PAIR";
    if (pairs === 1 && pairRank >= 9) return "JACKS_OR_BETTER";
    return "NOTHING";
  };
}

function popcount(bits: number): number {
  let count = 0;
  while (bits) { bits &= bits - 1; count++; }
  return count;
}

function canMakeFullHouse(counts: Uint8Array, wilds: number): boolean {
  for (let triple = 1; triple < 13; triple++) {
    for (let pair = 1; pair < 13; pair++) {
      if (triple === pair || counts[triple] > 3 || counts[pair] > 2) continue;
      // All five cards must fit these two ranks; no natural card may disappear.
      if (counts[triple] + counts[pair] + wilds === 5 &&
          3 - counts[triple] + 2 - counts[pair] === wilds) return true;
    }
  }
  return false;
}
