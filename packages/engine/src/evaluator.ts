import { sortedHand } from "./cards";
import { createClassifier } from "./classify";
import { COMBINATIONS, HAND_COUNT } from "./combinations";
import { getGameFamily } from "./families";
import type { Card, GameFamilyId, HandRankId } from "./types";

const tables = new Map<GameFamilyId, Uint8Array>();

/** Internal immutable-by-convention table. Never exported from the public API. */
export function lookupTable(familyId: GameFamilyId): Uint8Array {
  const existing = tables.get(familyId);
  if (existing) return existing;
  const family = getGameFamily(familyId);
  // Families sharing rank rules share the same 2.6 MB table.
  const equivalent = familyId === "bonus_poker_deluxe" ? "jacks_or_better"
    : familyId === "double_bonus" ? "bonus_poker" : undefined;
  if (equivalent) {
    const table = lookupTable(equivalent);
    tables.set(familyId, table);
    return table;
  }
  const classify = createClassifier(family);
  const indices = new Map(family.handRanks.map((rank, i) => [rank, i]));
  const table = new Uint8Array(HAND_COUNT);
  let index = 0;
  for (let e = 4; e < 52; e++)
    for (let d = 3; d < e; d++)
      for (let c = 2; c < d; c++)
        for (let b = 1; b < c; b++)
          for (let a = 0; a < b; a++)
            table[index++] = indices.get(classify(a, b, c, d, e))!;
  tables.set(familyId, table);
  return table;
}

/** Build lazily, or call explicitly before the first interactive analysis. */
export function initializeEvaluator(familyId: GameFamilyId = "jacks_or_better"): void {
  lookupTable(familyId);
}

export function evaluateHand(cards: readonly Card[], familyId: GameFamilyId = "jacks_or_better"): HandRankId {
  const family = getGameFamily(familyId);
  const sorted = sortedHand(cards);
  let index = 0;
  for (let i = 0; i < 5; i++) index += COMBINATIONS[i + 1][sorted[i]];
  return family.handRanks[lookupTable(familyId)[index]];
}

export function clearEvaluatorCache(): void {
  tables.clear();
}
