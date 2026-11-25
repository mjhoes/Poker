import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { payingRanks } from "../paytables/model";
import type { DraftTable } from "../paytables/model";

/**
 * The built-in table of the same game closest to a draft: fewest hands with a different max-bet pay, then the smallest
 * total difference. Used to say "matches 9/6 Double Double Bonus" or "differs only in Full House and Flush".
 */
export function closestLibraryTable(draft: DraftTable) {
  const ranks = payingRanks(draft.familyId);
  let best: { table: (typeof PAY_TABLE_LIBRARY)[number]; differing: string[]; distance: number } | null = null;
  for (const table of PAY_TABLE_LIBRARY.filter(item => item.familyId === draft.familyId)) {
    const pays = table.pays as Readonly<Record<string, readonly number[]>>;
    const differing = ranks.filter(rank => (draft.pays[rank]?.[4] ?? 0) !== (pays[rank]?.[4] ?? 0));
    const distance = ranks.reduce((sum, rank) => sum + Math.abs((draft.pays[rank]?.[4] ?? 0) - (pays[rank]?.[4] ?? 0)), 0);
    if (!best || differing.length < best.differing.length || (differing.length === best.differing.length && distance < best.distance)) best = { table, differing, distance };
  }
  return best ? { table: best.table, differing: best.differing } : null;
}

/** Rank of a return among the built-in tables of a game (1 = highest), counting this table in. */
export function returnRank(returnPct: number, libraryReturns: readonly number[]) {
  return { place: libraryReturns.filter(value => value > returnPct + 1e-9).length + 1, of: libraryReturns.length + 1 };
}
