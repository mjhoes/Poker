/*
 * The 32 holds of one hand, best first, with ties and close calls marked. Pure; the numbers are the engine's.
 */
export interface HoldRow { mask: number; label: string; ev: number }
export interface RankedHold extends HoldRow { rank: number; behind: number; best: boolean }
export interface RankedHolds { rows: RankedHold[]; bestEv: number; bestCount: number; closeCall: { gap: number; mask: number } | null }

const EPSILON = 1e-9;

/** Holds within this many credits per coin bet of the best (but not equal) are a close call: 0.05 at five coins. */
export const CLOSE_CALL_PER_COIN = 0.01;

export function rankHolds(results: readonly HoldRow[], coins: number): RankedHolds {
  const sorted = [...results].sort((a, b) => b.ev - a.ev || a.mask - b.mask);
  const bestEv = sorted[0]?.ev ?? 0;
  const rows = sorted.map((row, index) => ({ ...row, rank: index + 1, behind: bestEv - row.ev, best: bestEv - row.ev < EPSILON }));
  const runnerUp = rows.find(row => !row.best);
  const closeCall = runnerUp && runnerUp.behind <= CLOSE_CALL_PER_COIN * coins ? { gap: runnerUp.behind, mask: runnerUp.mask } : null;
  return { rows, bestEv, bestCount: rows.filter(row => row.best).length, closeCall };
}

/** One other machine or table: its best hold for the same cards, and what the selected table's best hold is worth there. */
export interface AcrossResult {
  paytableId: string; coins: number; name: string; machine: boolean; familyId: string;
  bestMask: number; bestLabel: string; bestEv: number; evByMask: readonly number[];
}
export interface AcrossRow extends AcrossResult { differs: boolean; cost: number }

/** Marks where the best hold differs from `mask` (the selected table's best), and what holding `mask` there would cost. */
export function compareAcross(mask: number, results: readonly AcrossResult[]): AcrossRow[] {
  return results.map(result => {
    const cost = Math.max(0, result.bestEv - (result.evByMask[mask] ?? 0));
    return { ...result, cost, differs: cost > EPSILON };
  });
}
