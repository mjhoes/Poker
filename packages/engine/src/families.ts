import type { GameFamily, GameFamilyId, HandRankId } from "./types";

const tail = ["FULL_HOUSE", "FLUSH", "STRAIGHT", "THREE_KIND", "TWO_PAIR", "JACKS_OR_BETTER", "NOTHING"] as const;
const make = (
  id: GameFamilyId,
  handRanks: readonly HandRankId[],
  quadKickers = false,
): GameFamily => Object.freeze({
  id,
  deck: Object.freeze({ size: 52 as const, jokers: 0 as const }),
  wilds: id === "deuces_wild" ? "deuces" as const : "none" as const,
  handRanks: Object.freeze([...handRanks]),
  ...(id === "deuces_wild" ? {} : { rankRules: Object.freeze({ minPair: "J" as const, quadKickers }) }),
});

export const GAME_FAMILIES: Readonly<Record<GameFamilyId, GameFamily>> = Object.freeze({
  jacks_or_better: make("jacks_or_better", ["ROYAL_FLUSH", "STRAIGHT_FLUSH", "FOUR_KIND", ...tail]),
  bonus_poker: make("bonus_poker", ["ROYAL_FLUSH", "STRAIGHT_FLUSH", "FOUR_ACES", "FOUR_234", "FOUR_5K", ...tail]),
  bonus_poker_deluxe: make("bonus_poker_deluxe", ["ROYAL_FLUSH", "STRAIGHT_FLUSH", "FOUR_KIND", ...tail]),
  double_bonus: make("double_bonus", ["ROYAL_FLUSH", "STRAIGHT_FLUSH", "FOUR_ACES", "FOUR_234", "FOUR_5K", ...tail]),
  double_double_bonus: make("double_double_bonus", [
    "ROYAL_FLUSH", "STRAIGHT_FLUSH", "FOUR_ACES_W_234", "FOUR_234_W_A234",
    "FOUR_ACES", "FOUR_234", "FOUR_5K", ...tail,
  ], true),
  deuces_wild: make("deuces_wild", [
    "NATURAL_ROYAL", "FOUR_DEUCES", "WILD_ROYAL", "FIVE_KIND", "STRAIGHT_FLUSH",
    "FOUR_KIND", "FULL_HOUSE", "FLUSH", "STRAIGHT", "THREE_KIND", "NOTHING",
  ]),
});

export function getGameFamily(id: GameFamilyId): GameFamily {
  if (!Object.hasOwn(GAME_FAMILIES, id)) throw new Error(`Unsupported game family: ${id}`);
  const family = GAME_FAMILIES[id];
  return family;
}
