import { choose, COMBINATIONS, HAND_COUNT } from "./combinations";
import { lookupTable } from "./evaluator";
import { getGameFamily } from "./families";
import type { GameFamilyId } from "./types";

/** Sizes 0..4 are stored; size 5 is already represented by the evaluator. */
const OFFSETS = [0];
for (let size = 0; size < 4; size++) OFFSETS.push(OFFSETS[size] + choose(52, size));
const SUBSET_COUNT = OFFSETS[4] + choose(52, 4);

export interface SubsetTables {
  readonly familyId: GameFamilyId;
  readonly width: number;
  readonly counts: Uint32Array;
  readonly finals: Uint8Array;
}

const cache = new Map<GameFamilyId, SubsetTables>();

export function subsetOffset(size: number, index: number, width: number): number {
  return (OFFSETS[size] + index) * width;
}

/** Count final hands by rank, not by payout; reusable across all value vectors. */
export function getSubsetTables(familyId: GameFamilyId): SubsetTables {
  const previous = cache.get(familyId);
  if (previous) return previous;
  const family = getGameFamily(familyId);
  const equivalent = familyId === "bonus_poker_deluxe" ? "jacks_or_better"
    : familyId === "double_bonus" ? "bonus_poker" : undefined;
  if (equivalent) {
    const shared = { ...getSubsetTables(equivalent), familyId };
    cache.set(familyId, shared);
    return shared;
  }
  const width = family.handRanks.length;
  const finals = lookupTable(familyId);
  const counts = new Uint32Array(SUBSET_COUNT * width);
  const c2 = COMBINATIONS[2], c3 = COMBINATIONS[3], c4 = COMBINATIONS[4];
  const offset = OFFSETS[4];
  let finalIndex = 0;
  // A final hand contributes once to each of its five four-card subsets.
  for (let e = 4; e < 52; e++)
    for (let d = 3; d < e; d++)
      for (let c = 2; c < d; c++)
        for (let b = 1; b < c; b++)
          for (let a = 0; a < b; a++) {
            const rank = finals[finalIndex++];
            counts[(offset + b + c2[c] + c3[d] + c4[e]) * width + rank]++;
            counts[(offset + a + c2[c] + c3[d] + c4[e]) * width + rank]++;
            counts[(offset + a + c2[b] + c3[d] + c4[e]) * width + rank]++;
            counts[(offset + a + c2[b] + c3[c] + c4[e]) * width + rank]++;
            counts[(offset + a + c2[b] + c3[c] + c4[d]) * width + rank]++;
          }
  if (finalIndex !== HAND_COUNT) throw new Error("Incomplete evaluator enumeration.");

  // Each final hand appears (5-k) times when reducing size k+1 to k.
  // This keeps construction small: we never allocate rank counts for size 5.
  for (let size = 3; size >= 0; size--) {
    const subset = new Array<number>(size + 1);
    const distribute = (depth: number, start: number): void => {
      if (depth !== subset.length) {
        for (let card = start; card <= 52 - (subset.length - depth); card++) {
          subset[depth] = card;
          distribute(depth + 1, card + 1);
        }
        return;
      }
      let parentIndex = 0;
      for (let i = 0; i < subset.length; i++) parentIndex += COMBINATIONS[i + 1][subset[i]];
      const source = subsetOffset(size + 1, parentIndex, width);
      for (let omitted = 0; omitted < subset.length; omitted++) {
        let childIndex = 0, position = 1;
        for (let i = 0; i < subset.length; i++) {
          if (i !== omitted) childIndex += COMBINATIONS[position++][subset[i]];
        }
        const target = subsetOffset(size, childIndex, width);
        for (let rank = 0; rank < width; rank++) counts[target + rank] += counts[source + rank];
      }
    };
    distribute(0, 0);
    const begin = OFFSETS[size] * width;
    const end = (OFFSETS[size] + choose(52, size)) * width;
    for (let i = begin; i < end; i++) {
      if (counts[i] % (5 - size)) throw new Error("Nonintegral subset count.");
      counts[i] /= 5 - size;
    }
  }
  const result = { familyId, width, counts, finals };
  cache.set(familyId, result);
  return result;
}

/** Release tables before moving to another family on memory-limited devices. */
export function clearSubsetCache(): void {
  cache.clear();
}

export function subsetTableBytes(familyId: GameFamilyId): number {
  return getSubsetTables(familyId).counts.byteLength;
}
