import type { Card, GameFamilyId, HandRankId } from "../src/types";

/** Deliberately separate, group/sort-based oracle, without engine lookup helpers. */
export function referenceRank(cards: readonly Card[], family: GameFamilyId): HandRankId {
  const ranks = cards.map(card => Math.floor(card / 4) + 2);
  const flush = cards.every(card => card % 4 === cards[0] % 4);
  if (family !== "deuces_wild") return naturalRank(ranks, flush, family);
  const naturals = cards.filter(card => Math.floor(card / 4) !== 0);
  const wildCount = 5 - naturals.length;
  if (wildCount === 4) return "FOUR_DEUCES";
  const naturalRanks = naturals.map(card => Math.floor(card / 4) + 2);
  const canFlush = naturals.every(card => card % 4 === naturals[0] % 4);
  if (!wildCount) {
    const rank = naturalRank(ranks, flush, "jacks_or_better");
    if (rank === "ROYAL_FLUSH") return "NATURAL_ROYAL";
    return rank === "TWO_PAIR" || rank === "JACKS_OR_BETTER" ? "NOTHING" : rank;
  }
  const order: HandRankId[] = [
    "WILD_ROYAL", "FIVE_KIND", "STRAIGHT_FLUSH", "FOUR_KIND",
    "FULL_HOUSE", "FLUSH", "STRAIGHT", "THREE_KIND", "NOTHING",
  ];
  let best = order.length - 1;
  function assign(remaining: number): void {
    if (remaining > 0) {
      for (let rank = 2; rank <= 14; rank++) {
        naturalRanks.push(rank);
        assign(remaining - 1);
        naturalRanks.pop();
      }
      return;
    }
    const groups = groupRanks(naturalRanks);
    const straight = isStraight(naturalRanks);
    let rank: HandRankId;
    if (canFlush && straight && Math.min(...naturalRanks) === 10) rank = "WILD_ROYAL";
    else if (groups[0][1] === 5) rank = "FIVE_KIND";
    else if (canFlush && straight) rank = "STRAIGHT_FLUSH";
    else if (groups[0][1] === 4) rank = "FOUR_KIND";
    else if (groups[0][1] === 3 && groups[1][1] === 2) rank = "FULL_HOUSE";
    else if (canFlush) rank = "FLUSH";
    else if (straight) rank = "STRAIGHT";
    else if (groups[0][1] === 3) rank = "THREE_KIND";
    else rank = "NOTHING";
    best = Math.min(best, order.indexOf(rank));
  }
  assign(wildCount);
  return order[best];
}

function groupRanks(ranks: readonly number[]): [number, number][] {
  const groups = new Map<number, number>();
  for (const rank of ranks) groups.set(rank, (groups.get(rank) ?? 0) + 1);
  return [...groups].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
}

function isStraight(ranks: readonly number[]): boolean {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b);
  return sorted.length === 5 &&
    (sorted[4] - sorted[0] === 4 || sorted.join(",") === "2,3,4,5,14");
}

function naturalRank(ranks: readonly number[], flush: boolean, family: GameFamilyId): HandRankId {
  const groups = groupRanks(ranks);
  if (flush && isStraight(ranks)) return Math.min(...ranks) === 10 ? "ROYAL_FLUSH" : "STRAIGHT_FLUSH";
  if (groups[0][1] === 4) {
    const [quad, kicker] = [groups[0][0], groups[1][0]];
    if (family === "jacks_or_better" || family === "bonus_poker_deluxe") return "FOUR_KIND";
    if (family === "double_double_bonus") {
      if (quad === 14 && kicker >= 2 && kicker <= 4) return "FOUR_ACES_W_234";
      if (quad >= 2 && quad <= 4 && (kicker === 14 || kicker <= 4)) return "FOUR_234_W_A234";
    }
    return quad === 14 ? "FOUR_ACES" : quad <= 4 ? "FOUR_234" : "FOUR_5K";
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) return "FULL_HOUSE";
  if (flush) return "FLUSH";
  if (isStraight(ranks)) return "STRAIGHT";
  if (groups[0][1] === 3) return "THREE_KIND";
  if (groups[0][1] === 2 && groups[1][1] === 2) return "TWO_PAIR";
  if (groups[0][1] === 2 && groups[0][0] >= 11) return "JACKS_OR_BETTER";
  return "NOTHING";
}

/** Seeded generator so random regression cases are reproducible. */
export function seededHands(count: number): number[][] {
  let seed = 0x12345678;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  return Array.from({ length: count }, () => {
    const hand = new Set<number>();
    while (hand.size < 5) hand.add(random() % 52);
    return [...hand];
  });
}
