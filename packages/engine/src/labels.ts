import { validateHand } from "./cards";
import { evaluateHand } from "./evaluator";
import { getGameFamily } from "./families";
import type { Card, CategoryLabel, GameFamilyId, HandRankId } from "./types";

const RANK_NAMES = "23456789TJQKA";
const ROYAL_BITS = 31 << 8;
export const STRAIGHT_WINDOWS = [0x100f, ...Array.from({ length: 9 }, (_, i) => 31 << i)];
const MADE: Record<HandRankId, string> = {
  ROYAL_FLUSH: "RF", NATURAL_ROYAL: "RF", FOUR_DEUCES: "4D", WILD_ROYAL: "WRF",
  FIVE_KIND: "5K", STRAIGHT_FLUSH: "SF", FOUR_ACES_W_234: "4K_A_w234",
  FOUR_234_W_A234: "4K_234_wA234", FOUR_ACES: "4K_A", FOUR_234: "4K_234",
  FOUR_5K: "4K_5K", FOUR_KIND: "4K", FULL_HOUSE: "FH", FLUSH: "FL",
  STRAIGHT: "ST", THREE_KIND: "3K", TWO_PAIR: "2P", JACKS_OR_BETTER: "HP", NOTHING: "HIGH_CARD",
};
const SUIT_ORDERS: number[][] = [];
for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++)
  for (let c = 0; c < 4; c++) for (let d = 0; d < 4; d++) {
    if (new Set([a, b, c, d]).size === 4) SUIT_ORDERS.push([a, b, c, d]);
  }

/** A payout-independent, suit-renaming-invariant held/discard relationship. */
export function holdSuitPattern(cards: readonly Card[], mask: number): string {
  let best = "~";
  for (const suits of SUIT_ORDERS) {
    const held: number[] = [], discarded: number[] = [];
    for (let i = 0; i < 5; i++) {
      const card = (cards[i] & ~3) + suits[cards[i] & 3];
      (mask & (1 << i) ? held : discarded).push(card);
    }
    held.sort((a, b) => a - b); discarded.sort((a, b) => a - b);
    const key = held.map(card => card & 3).join("") + "/" + discarded.map(card => card & 3).join("");
    if (key < best) best = key;
  }
  return best;
}

export interface HoldPattern {
  readonly label: CategoryLabel;
  readonly base: CategoryLabel;
  readonly heldRanks: string;
  readonly discardedRanks: string;
  readonly highCards: number;
  readonly wilds: number;
  readonly flushPenalty: number;
  readonly straightPenalty: number;
}

function bitsCount(value: number): number {
  let count = 0;
  for (; value; value &= value - 1) count++;
  return count;
}

/** Internal hot path; caller has already validated cards, mask, and family. */
export function describeHoldUnchecked(cards: readonly Card[], mask: number, familyId: GameFamilyId): HoldPattern {
  const held: number[] = [], discarded: number[] = [];
  const counts = new Uint8Array(13);
  let wilds = 0, bits = 0, highCards = 0, naturalSuit = -1, suited = true;
  for (let i = 0; i < 5; i++) {
    const card = cards[i];
    if (!(mask & (1 << i))) { discarded.push(card); continue; }
    held.push(card);
    const rank = card >> 2;
    if (familyId === "deuces_wild" && rank === 0) { wilds++; continue; }
    counts[rank]++;
    bits |= 1 << rank;
    if (rank >= 9) highCards++;
    if (naturalSuit < 0) naturalSuit = card & 3;
    else if ((card & 3) !== naturalSuit) suited = false;
  }
  const n = held.length;
  const ranks = Array.from({ length: 13 }, (_, i) => i).filter(rank => counts[rank] > 0);
  let maxCount = 0, pairCount = 0, pairRank = -1;
  for (const rank of ranks) {
    maxCount = Math.max(maxCount, counts[rank]);
    if (counts[rank] === 2) { pairCount++; pairRank = rank; }
  }
  const unique = bitsCount(bits) === n - wilds;
  const straightWindows = unique ? STRAIGHT_WINDOWS.filter(window => (bits & ~window) === 0) : [];
  const wheelAce = ranks.includes(12) && ranks.some(rank => rank < 4);
  const spanRanks = wheelAce ? ranks.map(rank => rank === 12 ? -1 : rank) : ranks;
  const gaps = spanRanks.length ? Math.max(...spanRanks) - Math.min(...spanRanks) + 1 - spanRanks.length : 0;
  const rankAware = familyId === "bonus_poker" || familyId === "double_bonus" || familyId === "double_double_bonus";
  const lowEnd = Number(straightWindows.some(window => !!(window & 1)));
  const wildDrawDetail = familyId === "deuces_wild" ? `_w${straightWindows.length}_d${lowEnd}` : "";
  let base: string;
  if (n === 0) base = "DRAW5";
  else if (n === 5) base = MADE[evaluateHand(cards, familyId)];
  else if (wilds === n) base = wilds === 4 ? "4D" : "ONLY";
  else if (maxCount + wilds >= 4) {
    const rank = ranks.find(rank => counts[rank] === maxCount)!;
    base = familyId === "deuces_wild" || familyId === "jacks_or_better" || familyId === "bonus_poker_deluxe"
      ? "4K" : rank === 12 ? "4K_A" : rank <= 2 ? "4K_234" : "4K_5K";
  } else if (!wilds && maxCount === 3) base = "3K";
  else if (!wilds && pairCount === 2) base = "2P";
  else if (!wilds && pairCount === 1) base = pairRank >= 9 ? "HP" : "LP";
  else if (suited && unique && bits && (bits & ~ROYAL_BITS) === 0 && n >= 2) {
    const royalRanks = [...ranks].reverse().map(rank => RANK_NAMES[rank]).join("");
    base = n === 4 ? "4RF" : n === 3 ? familyId === "deuces_wild" ? "3RF" : `3RF_h${highCards}` : `2RF_${royalRanks}`;
    if (n >= 3) base += wildDrawDetail;
  } else if (n === 4 && suited && straightWindows.length) {
    base = familyId === "deuces_wild" ? `4SF_g${gaps}${wildDrawDetail}` :
      `4SF_${straightWindows.length >= 2 ? "open" : "inside"}`;
  } else if (n === 4 && suited) base = "4FL";
  else if (n === 4 && straightWindows.length) base = familyId === "deuces_wild" ?
    `4ST_g${gaps}${wildDrawDetail}` : `4ST_${straightWindows.length >= 2 ? "open" : "inside"}_h${highCards}`;
  else if (n === 3 && suited && straightWindows.length) {
    const is234 = bits === 7;
    // Wizard of Odds' standard JoB convention explicitly puts ace-low and
    // 234 in type 2; type 3 is a two-gap draw without a high card.
    const type = wheelAce || is234 ? 2 : highCards >= gaps ? 1 : highCards + 1 >= gaps ? 2 : 3;
    base = familyId === "deuces_wild" ? `3SF_g${gaps}${wildDrawDetail}` : `3SF_t${type}`;
  } else if (maxCount + wilds >= 3) base = "3K";
  else if (n === 3 && bits === ((1 << 9) | (1 << 10) | (1 << 11))) base = "KQJ_unsuited";
  else if (n === 3 && suited) base = `3FL_h${highCards}`;
  else if (n === 3 && straightWindows.length) base = `3ST_g${gaps}_h${highCards}_w${straightWindows.length}${familyId === "deuces_wild" ? `_d${lowEnd}` : ""}`;
  else if (n === 2 && suited && straightWindows.length) base = `2SF_g${gaps}_h${highCards}_w${straightWindows.length}${familyId === "deuces_wild" ? `_d${lowEnd}` : ""}`;
  else if (n === 2 && highCards === 2) {
    base = [...ranks].reverse().map(rank => RANK_NAMES[rank]).join("") + "_unsuited";
  } else if (n === 1 && highCards === 1) base = `1H_${RANK_NAMES[ranks[0]]}`;
  else base = `OTHER_${n}`;

  if (rankAware) {
    if (base === "HP" && pairRank === 12) base = "HP_A";
    else if (base === "LP") base = pairRank <= 2 ? "LP_234" : "LP_5T";
    else if (base === "2P" && counts[12] === 2) base = "2P_A";
    else if (base === "3K") {
      const trip = ranks.find(rank => counts[rank] === 3)!;
      base = trip === 12 ? "3K_A" : trip <= 2 ? "3K_234" : "3K_5K";
      if (familyId === "double_double_bonus" && n === 4 &&
          (trip === 12 || trip <= 2) && ranks.some(rank => rank !== trip && (rank <= 2 || trip <= 2 && rank === 12))) {
        base += trip === 12 ? "_w234" : "_wA234";
      }
    }
  }
  if (familyId === "deuces_wild") base = `D${wilds}_${base}`;
  const isDraw = unique && bits !== 0 && n > 0 && n < 5;
  const flushPenalty = isDraw && suited && naturalSuit >= 0
    ? discarded.filter(card => (card & 3) === naturalSuit && !(familyId === "deuces_wild" && card >> 2 === 0)).length : 0;
  const outBits = straightWindows.reduce((union, window) => union | window, 0) & ~bits;
  const straightPenalty = isDraw ? discarded.filter(card => (outBits & (1 << (card >> 2))) !== 0).length : 0;
  const penalties = [flushPenalty ? "flush" : "", straightPenalty ? "straight" : ""].filter(Boolean);
  const rankString = (values: readonly number[]) => values.map(card => card >> 2).sort((a, b) => b - a)
    .map(rank => RANK_NAMES[rank]).join("");
  return {
    base, label: base + (penalties.length ? `|pen:${penalties.join(",")}` : ""),
    heldRanks: rankString(held), discardedRanks: rankString(discarded),
    highCards, wilds, flushPenalty, straightPenalty,
  };
}

export function describeHold(cards: readonly Card[], mask: number, familyId: GameFamilyId = "jacks_or_better"): HoldPattern {
  validateHand(cards);
  getGameFamily(familyId);
  if (!Number.isInteger(mask) || mask < 0 || mask > 31) throw new RangeError("Hold mask must be an integer from 0 to 31.");
  return describeHoldUnchecked(cards, mask, familyId);
}

export function labelHold(cards: readonly Card[], mask: number, familyId: GameFamilyId = "jacks_or_better"): CategoryLabel {
  return describeHold(cards, mask, familyId).label;
}

/** Deterministic context for learned refinements, independent of payout values. */
export function refinementKey(pattern: HoldPattern, level: number): string {
  if (level === 2) {
    return pattern.label.includes("|") ? pattern.label : `${pattern.base}|pen:none`;
  }
  if (level === 0) return pattern.base;
  if (!/(?:RF|SF|FL|ST)/.test(pattern.base) || pattern.base === "RF" || pattern.base === "SF" ||
      pattern.base === "FL" || pattern.base === "ST") return pattern.label;
  if (level === 1) {
    const ranks = /3RF|3SF/.test(pattern.base) ? `|r:${pattern.heldRanks}` : "";
    return `${pattern.label}${ranks}|p:${pattern.flushPenalty},${pattern.straightPenalty}`;
  }
  return `${pattern.label}|r:${pattern.heldRanks}|p:${pattern.flushPenalty},${pattern.straightPenalty}|d:${pattern.discardedRanks}`;
}
