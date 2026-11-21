/** 0–51 = rank * 4 + suit; ranks 2..A, suits clubs/diamonds/hearts/spades. */
export type Card = number;
export type Hand = readonly [Card, Card, Card, Card, Card];
export type CardMask = readonly [low: number, high: number];

export type HandRankId =
  | "ROYAL_FLUSH" | "NATURAL_ROYAL" | "FOUR_DEUCES" | "WILD_ROYAL"
  | "FIVE_KIND" | "STRAIGHT_FLUSH" | "FOUR_ACES_W_234" | "FOUR_234_W_A234"
  | "FOUR_ACES" | "FOUR_234" | "FOUR_5K" | "FOUR_KIND" | "FULL_HOUSE"
  | "FLUSH" | "STRAIGHT" | "THREE_KIND" | "TWO_PAIR" | "JACKS_OR_BETTER"
  | "NOTHING";

export type GameFamilyId =
  | "jacks_or_better" | "bonus_poker" | "bonus_poker_deluxe"
  | "double_bonus" | "double_double_bonus" | "deuces_wild";

export interface GameFamily {
  readonly id: GameFamilyId;
  readonly deck: { readonly size: 52; readonly jokers: 0 };
  readonly wilds: "none" | "deuces";
  /** Vector positions, best rank first. NOTHING is explicit and must pay zero. */
  readonly handRanks: readonly HandRankId[];
  readonly rankRules?: { readonly quadKickers?: boolean; readonly minPair?: "J" };
}

/** Payouts in total coins returned, indexed by family.handRanks. */
export type ValueVector = readonly number[];

export interface HoldResult {
  /** Bit i refers to cards[i] in the original (not sorted) input hand. */
  readonly mask: number;
  readonly ev: number;
  readonly rankDist: readonly number[];
  readonly rankCounts: readonly number[];
  readonly drawCount: number;
}

export interface HandAnalysis {
  readonly familyId: GameFamilyId;
  readonly hand: Hand;
  readonly results: readonly HoldResult[];
  readonly best: HoldResult;
  readonly gapToSecond: number;
}

export interface PayTable {
  readonly id: string;
  readonly familyId: GameFamilyId;
  readonly name?: string;
  /** Total returned coins for bets of 1, 2, 3, 4, 5 coins respectively. */
  readonly pays: Readonly<Partial<Record<HandRankId, readonly [number, number, number, number, number]>>>;
  readonly source: "library" | "photo" | "manual";
}

export type VariantKind = "standard" | "ultimate_x" | "super_times_pay" | "multi_strike" | "dream_card";
export type VariantState = { lineMultipliers?: number[]; level?: number; [key: string]: unknown };

export interface GameVariant {
  readonly kind: VariantKind;
  readonly config: unknown;
  valueVector(payTable: PayTable, coins: number, state: VariantState): number[];
  nextState(state: VariantState, finalRanksPerLine: readonly HandRankId[]): VariantState;
  betCoins(coins: number, lines: number): number;
}
