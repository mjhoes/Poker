import { getGameFamily } from "@perfect-draw/engine";
import type { GameFamilyId } from "@perfect-draw/engine";
import { handRankName } from "../components/UiHelpers";

/*
 * Why one hold beats another, from numbers the engine already computed: for each hold, the count of every final hand
 * over all possible draws. Chance × pay summed over final hands is exactly the hold's expected value. Pure and unit
 * tested; the future AI coach is meant to explain these same rows in words, never to compute its own.
 */

/** The parts of a hand analysis this needs (engine result or saved session copy). */
export interface HandAnalysis {
  familyId: GameFamilyId; valueVector: readonly number[];
  results: readonly { mask: number; label: string; ev: number; rankDist: readonly number[]; rankCounts: readonly number[]; drawCount: number }[];
}
export interface BreakdownRow { rank: string; name: string; count: number; probability: number; pay: number; ev: number }
export interface HoldBreakdown { mask: number; label: string; drawCount: number; ev: number; winProbability: number; rows: BreakdownRow[] }
export interface ComparisonRow { rank: string; name: string; a: BreakdownRow; b: BreakdownRow; delta: number }
export interface HoldComparison { a: HoldBreakdown; b: HoldBreakdown; delta: number; rows: ComparisonRow[]; decisive: string[] }

export function holdBreakdown(analysis: HandAnalysis, mask: number): HoldBreakdown {
  const result = analysis.results.find(row => row.mask === mask);
  if (!result) throw new Error("That hold is not in this hand's analysis.");
  const ranks = getGameFamily(analysis.familyId).handRanks;
  const rows = ranks.map((rank, index) => ({
    rank, name: handRankName(rank), count: result.rankCounts[index] ?? 0, probability: result.rankDist[index] ?? 0,
    pay: analysis.valueVector[index] ?? 0, ev: (result.rankDist[index] ?? 0) * (analysis.valueVector[index] ?? 0),
  }));
  return {
    mask, label: result.label, drawCount: result.drawCount, ev: result.ev,
    // A win is a final hand that pays; a custom table can pay zero for ranks other than "nothing".
    winProbability: rows.reduce((sum, row) => sum + (row.pay > 0 ? row.probability : 0), 0),
    rows: rows.filter(row => row.rank !== "NOTHING"),
  };
}

/** Side by side, row by row; `decisive` lists the final hands that account for most of the difference (largest first). */
export function compareHolds(analysis: HandAnalysis, aMask: number, bMask: number): HoldComparison {
  const a = holdBreakdown(analysis, aMask), b = holdBreakdown(analysis, bMask);
  const rows = a.rows.map((row, index) => ({ rank: row.rank, name: row.name, a: row, b: b.rows[index], delta: row.ev - b.rows[index].ev }))
    .filter(row => row.a.count > 0 || row.b.count > 0);
  const total = Math.abs(a.ev - b.ev);
  const decisive = [...rows].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .filter((row, index) => index === 0 || Math.abs(row.delta) >= Math.max(0.05, total * 0.2)).slice(0, 3).map(row => row.rank);
  return { a, b, delta: a.ev - b.ev, rows, decisive };
}

/** "1 in 1,081" for a count out of all possible draws. */
export function oneIn(count: number, drawCount: number) {
  if (!count) return "—";
  const n = drawCount / count;
  return n < 1.05 ? "every draw" : `1 in ${n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1).replace(/\.0$/, "")}`;
}

const pct = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
const credits = (value: number) => value.toFixed(2);

/**
 * A plain sentence built only from the comparison's numbers (no AI): which hold wins more often, which final hands
 * make the stronger hold worth more, and the net difference per line.
 */
export function comparisonSummary(comparison: HoldComparison, names: { a: string; b: string }) {
  const { a, b } = comparison;
  if (Math.abs(comparison.delta) < 1e-9) return `${names.a} and ${names.b} are worth exactly the same: ${credits(a.ev)} credits per line.`;
  const [stronger, weaker, strongName, weakName] = comparison.delta > 0 ? [a, b, names.a, names.b] : [b, a, names.b, names.a];
  const sign = comparison.delta > 0 ? 1 : -1;
  const gains = comparison.rows.filter(row => sign * row.delta > 0.005).sort((x, y) => sign * y.delta - sign * x.delta).slice(0, 2);
  const describe = (row: ComparisonRow, index: number) => {
    const own = sign > 0 ? row.a : row.b;
    const rare = own.count > 0 && stronger.drawCount / own.count >= 20;
    // Rare hands get their odds spelled out: that is where "small chance, big pay" shows.
    return `${row.name} (${rare || index === 0 ? `${oneIn(own.count, stronger.drawCount)} draws, ` : ""}+${credits(Math.abs(row.delta))})`;
  };
  const value = `${strongName.toLowerCase().startsWith("the ") && weaker.winProbability > stronger.winProbability + 0.005 ? strongName.replace(/^The /, "the ") : strongName} is worth ${credits(Math.abs(comparison.delta))} more credits per line`;
  const source = gains.length ? `, mostly from ${gains.map(describe).join(" and ")}` : "";
  const opening = weaker.winProbability > stronger.winProbability + 0.005
    ? `${weakName} wins more often (${pct(weaker.winProbability)} of draws vs ${pct(stronger.winProbability)}), but ${value}`
    : value;
  return `${opening[0].toUpperCase()}${opening.slice(1)}${source}.`;
}
