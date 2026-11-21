import { getGameFamily } from "./families";
import { validateValueVector } from "./solver";
import type { GameVariant, HandRankId, PayTable, VariantState } from "./types";

function validateCoins(coins: number): void {
  if (!Number.isInteger(coins) || coins < 1 || coins > 5) {
    throw new RangeError("Coins must be an integer from 1 to 5.");
  }
}

export const standardVariant: GameVariant = Object.freeze({
  kind: "standard",
  config: Object.freeze({}),
  valueVector(payTable: PayTable, coins: number, _state: VariantState): number[] {
    validateCoins(coins);
    const family = getGameFamily(payTable.familyId);
    const vector = family.handRanks.map(rank => {
      if (rank === "NOTHING") {
        const row = payTable.pays.NOTHING;
        if (row && (row.length !== 5 || Array.from(row).some(value => value !== 0))) {
          throw new Error("NOTHING must have five zero payouts.");
        }
        return 0;
      }
      const row = payTable.pays[rank];
      if (!row || row.length !== 5 || Array.from(row).some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error(`Missing or invalid five-column payout row: ${rank}`);
      }
      return row[coins - 1];
    });
    validateValueVector(vector, family.id);
    return vector;
  },
  nextState(_state: VariantState, _finalRanksPerLine: readonly HandRankId[]): VariantState {
    return {};
  },
  betCoins(coins: number, lines: number): number {
    validateCoins(coins);
    if (!Number.isSafeInteger(lines) || lines < 1 || !Number.isSafeInteger(coins * lines)) {
      throw new RangeError("Lines and total bet must be positive safe integers.");
    }
    return coins * lines;
  },
});
