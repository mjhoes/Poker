import { getGameFamily } from "@perfect-draw/engine";
import type { GameFamilyId } from "@perfect-draw/engine";
import { PAY_TABLE_LIBRARY, payTableId } from "@perfect-draw/paytables";

/**
 * Pure model behind the pay table editor: build a table from per-coin pays, fill it from shorthand ("9/6") or pasted
 * text, and check it for likely typos. The engine computes the return; nothing here estimates money.
 */

export type PayRow = [number, number, number, number, number];
export type PaysMatrix = Record<string, PayRow>;
export interface DraftTable { familyId: GameFamilyId; pays: PaysMatrix }
export interface Issue { rank?: string; level: "error" | "warning"; message: string }

export const isRoyal = (rank: string) => rank === "ROYAL_FLUSH" || rank === "NATURAL_ROYAL";
export const payingRanks = (familyId: GameFamilyId): string[] => getGameFamily(familyId).handRanks.filter(rank => rank !== "NOTHING");

/** A row that scales with the bet; the royal keeps its separate max-bet total, as on real machines. */
export function linearRow(rank: string, perCoin: number, royalMax?: number): PayRow {
  const row = [1, 2, 3, 4, 5].map(coins => perCoin * coins) as PayRow;
  if (isRoyal(rank)) row[4] = royalMax ?? (perCoin >= 250 ? 4000 : perCoin * 5);
  return row;
}

const copyPays = (pays: Record<string, readonly number[]>): PaysMatrix =>
  Object.fromEntries(Object.entries(pays).map(([rank, row]) => [rank, [...row] as PayRow]));

/** Start from the family's first library table, so most edits are one or two numbers. */
export function draftFromLibrary(familyId: GameFamilyId, slugOrId?: string): DraftTable {
  const table = PAY_TABLE_LIBRARY.find(item => item.familyId === familyId && (!slugOrId || item.id === slugOrId || item.slug === slugOrId))
    ?? PAY_TABLE_LIBRARY.find(item => item.familyId === familyId);
  if (table) return { familyId, pays: copyPays(table.pays) };
  return { familyId, pays: Object.fromEntries(getGameFamily(familyId).handRanks.map(rank => [rank, [0, 0, 0, 0, 0] as PayRow])) };
}

export const perCoin = (draft: DraftTable, rank: string) => draft.pays[rank]?.[0] ?? 0;

export function setPerCoin(draft: DraftTable, rank: string, value: number): DraftTable {
  const royalMax = isRoyal(rank) ? draft.pays[rank]?.[4] : undefined;
  return { ...draft, pays: { ...draft.pays, [rank]: linearRow(rank, value, royalMax) } };
}
export function setCell(draft: DraftTable, rank: string, column: number, value: number): DraftTable {
  const row = [...(draft.pays[rank] ?? [0, 0, 0, 0, 0])] as PayRow;
  row[column] = value;
  return { ...draft, pays: { ...draft.pays, [rank]: row } };
}
/** True when every row (except the royal's max-bet column) is a straight multiple of its 1-coin pay. */
export const isLinear = (draft: DraftTable) => payingRanks(draft.familyId).every(rank =>
  (draft.pays[rank] ?? []).every((value, column) => (isRoyal(rank) && column === 4) || value === (draft.pays[rank]?.[0] ?? 0) * (column + 1)));

/** Rows that common shorthand refers to, in the order the numbers are written. */
const SHORTHAND_ROWS: Record<GameFamilyId, string[]> = {
  jacks_or_better: ["FULL_HOUSE", "FLUSH", "STRAIGHT"],
  bonus_poker: ["FULL_HOUSE", "FLUSH", "STRAIGHT"],
  bonus_poker_deluxe: ["FULL_HOUSE", "FLUSH", "STRAIGHT"],
  double_bonus: ["FULL_HOUSE", "FLUSH", "STRAIGHT"],
  double_double_bonus: ["FULL_HOUSE", "FLUSH", "STRAIGHT"],
  deuces_wild: ["FOUR_DEUCES", "WILD_ROYAL", "FIVE_KIND", "STRAIGHT_FLUSH", "FOUR_KIND", "FULL_HOUSE", "FLUSH", "STRAIGHT", "THREE_KIND"],
};
export const shorthandRows = (familyId: GameFamilyId) => SHORTHAND_ROWS[familyId];

const numbersIn = (text: string) => text.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];

/** Royal written per coin at max bet (e.g. 800) becomes 250 per coin below max and 800 × 5 at max. */
function royalRow(rank: string, value: number): PayRow {
  return value >= 400 ? [250, 500, 750, 1000, value * 5] : linearRow(rank, value);
}

/**
 * Shorthand such as "9/6" (full house / flush), "10/7/5" (adds straight), deuces "200/25/15/9/5/3/2/2/1", or a
 * complete top-to-bottom list of per-coin pays. Returns the rows it changed.
 */
export function quickFill(draft: DraftTable, text: string): { draft: DraftTable; changed: string[] } | { error: string } {
  const numbers = numbersIn(text);
  if (!numbers.length) return { error: "Type the pays separated by slashes, like 9/6." };
  if (numbers.some(value => !Number.isInteger(value))) return { error: "Use whole numbers." };
  const all = payingRanks(draft.familyId);
  const rows = numbers.length === all.length ? all : SHORTHAND_ROWS[draft.familyId];
  if (numbers.length > rows.length) return { error: `Expected up to ${rows.length} numbers (${rows.length === all.length ? "every paying hand" : "the usual shorthand"}), or all ${all.length} pays.` };
  let next = draft;
  numbers.forEach((value, index) => {
    const rank = rows[index];
    next = isRoyal(rank) ? { ...next, pays: { ...next.pays, [rank]: royalRow(rank, value) } } : setPerCoin(next, rank, value);
  });
  return { draft: next, changed: rows.slice(0, numbers.length) };
}

// ── Pasted text ──

const normalize = (text: string) => text.toLowerCase()
  .replace(/&|\+/g, " with ").replace(/\bw\//g, "with ")
  .replace(/(\d)\s*-\s*([\dakqj])\b/g, "$1 $2").replace(/\b([akqj])\s*-\s*([\dakqj])\b/g, "$1 $2")
  .replace(/[^a-z0-9]+/g, " ").replace(/\b(\d+|[akqj])s\b/g, "$1").replace(/\bthru\b|\bthrough\b|\bto\b/g, " ")
  .replace(/\s+/g, " ").trim();

const SYNONYMS: Record<string, string[]> = {
  ROYAL_FLUSH: ["royal flush", "royal"],
  NATURAL_ROYAL: ["natural royal flush", "natural royal", "royal flush", "royal"],
  FOUR_DEUCES: ["four deuces", "4 deuces", "four 2", "4 2"],
  WILD_ROYAL: ["wild royal flush", "wild royal", "deuces royal", "deuce royal"],
  FIVE_KIND: ["five of a kind", "5 of a kind", "five kind", "5oak"],
  STRAIGHT_FLUSH: ["straight flush", "str flush", "sf"],
  FOUR_KIND: ["four of a kind", "4 of a kind", "four kind", "quads", "4oak"],
  FOUR_ACES_W_234: ["four aces with 2 3 4", "four aces with 2 4", "4 aces with 2 3 4", "4 aces with 2 4", "four aces 2 4 kicker", "4 aces 2 4 kicker", "four aces with kicker", "4 aces with kicker"],
  FOUR_234_W_A234: ["four 2 3 4 with a 2 3 4", "four 2 4 with a 4", "4 2 4 with a 4", "four 2 3 4 with a 4", "4 2 3 4 with a 4", "four 2 4 with kicker", "4 2 4 with kicker"],
  FOUR_ACES: ["four aces", "4 aces", "four ace", "4 ace"],
  FOUR_234: ["four 2 3 4", "four 2 4", "4 2 3 4", "4 2 4", "four twos threes fours"],
  FOUR_5K: ["four 5 k", "4 5 k", "four fives kings", "four 5 kings"],
  FULL_HOUSE: ["full house", "full", "fh"],
  FLUSH: ["flush"],
  STRAIGHT: ["straight"],
  THREE_KIND: ["three of a kind", "3 of a kind", "three kind", "trips", "3oak"],
  TWO_PAIR: ["two pair", "2 pair", "two pairs"],
  JACKS_OR_BETTER: ["jacks or better", "jacks or higher", "pair of jacks or better", "pair of jacks", "jacks", "high pair"],
};

/** The family's hand whose name best matches a label: the longest matching phrase wins ("four aces with 2-4" over "four aces"). */
export function matchRank(label: string, familyId: GameFamilyId): string | null {
  const text = ` ${normalize(label)} `;
  let best: { rank: string; length: number } | null = null;
  for (const rank of payingRanks(familyId)) {
    for (const phrase of SYNONYMS[rank] ?? []) {
      const needle = ` ${normalize(phrase)} `;
      if (text.includes(needle) && (!best || needle.length > best.length)) best = { rank, length: needle.length };
    }
  }
  return best?.rank ?? null;
}

/**
 * Text copied from a website or a note: one hand per line with one pay (per coin) or five (one per coin bet).
 * Lines with no hand name fill the rows from the top. Unrecognized lines are reported, never guessed.
 */
export function parsePasted(draft: DraftTable, text: string): { draft: DraftTable; changed: string[]; unmatched: string[] } {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const order = payingRanks(draft.familyId);
  let next = draft;
  const changed: string[] = [];
  const unmatched: string[] = [];
  let position = 0;
  for (const line of lines) {
    const tokens = line.replace(/(\d),(\d{3})/g, "$1$2").split(/[\s\t|]+/).filter(Boolean);
    let split = tokens.length;
    while (split > 0 && /^\d+(?:\.\d+)?$/.test(tokens[split - 1])) split--;
    let values = tokens.slice(split).map(Number);
    let label = tokens.slice(0, split).join(" ");
    // Two to four trailing numbers are usually part of the name ("Four 2 3 4 80"): keep only the last as the pay.
    if (values.length > 5) { label = [label, ...values.slice(0, values.length - 5)].join(" "); values = values.slice(-5); }
    else if (values.length > 1 && values.length < 5) { label = [label, ...values.slice(0, -1)].join(" "); values = values.slice(-1); }
    if (!values.length) { if (label) unmatched.push(line); continue; }
    const rank = label.trim() ? matchRank(label, draft.familyId) : order[position];
    if (!rank) { unmatched.push(line); continue; }
    position = order.indexOf(rank) + 1;
    if (values.length === 5) next = { ...next, pays: { ...next.pays, [rank]: values as PayRow } };
    else next = isRoyal(rank) ? { ...next, pays: { ...next.pays, [rank]: royalRow(rank, values[0]) } } : setPerCoin(next, rank, values[0]);
    changed.push(rank);
  }
  return { draft: next, changed, unmatched };
}

// ── Checks ──

/**
 * Pairs that hold in every real pay table (better first). Bonus games deliberately pay some quads more than a straight
 * flush, so rows are not simply compared top to bottom.
 */
function orderingPairs(familyId: GameFamilyId): [string, string][] {
  const ranks = new Set(payingRanks(familyId));
  const chain = (list: string[]) => list.filter(rank => ranks.has(rank)).flatMap((rank, index, all) => index ? [[all[index - 1], rank] as [string, string]] : []);
  if (familyId === "deuces_wild") return chain(payingRanks(familyId));
  const quads = [...ranks].filter(rank => rank.startsWith("FOUR_"));
  return [
    ...chain(["ROYAL_FLUSH", "STRAIGHT_FLUSH"]),
    ...chain(["FULL_HOUSE", "FLUSH", "STRAIGHT", "THREE_KIND", "TWO_PAIR", "JACKS_OR_BETTER"]),
    ...quads.map(rank => [rank, "FULL_HOUSE"] as [string, string]),
  ];
}

/** Errors block saving; warnings point at likely typos (a flush paying more than a full house, a hand paying nothing). */
export function validate(draft: DraftTable, rankName: (rank: string) => string): Issue[] {
  const issues: Issue[] = [];
  const ranks = payingRanks(draft.familyId);
  for (const rank of ranks) {
    const row = draft.pays[rank];
    if (!row || row.length !== 5 || row.some(value => !Number.isFinite(value) || value < 0)) issues.push({ rank, level: "error", message: `${rankName(rank)} needs a pay for every bet.` });
    else if (row.some(value => !Number.isInteger(value))) issues.push({ rank, level: "error", message: `${rankName(rank)}: use whole numbers.` });
    else if (row[4] === 0) issues.push({ rank, level: "warning", message: `${rankName(rank)} pays nothing. Is that right?` });
  }
  if (ranks.every(rank => (draft.pays[rank]?.[4] ?? 0) === 0)) issues.push({ level: "error", message: "Enter at least one pay." });
  const pay = (rank: string) => draft.pays[rank]?.[4] ?? 0;
  for (const [better, worse] of orderingPairs(draft.familyId)) {
    if (pay(worse) > pay(better)) issues.push({ rank: worse, level: "warning", message: `${rankName(worse)} pays more than ${rankName(better)} at max bet. Check for a typo.` });
  }
  return issues;
}

/** Complete record content: every family rank, with "nothing" paying zero. The id is the content hash. */
export function finalize(draft: DraftTable) {
  const pays: PaysMatrix = Object.fromEntries(getGameFamily(draft.familyId).handRanks.map(rank =>
    [rank, rank === "NOTHING" ? [0, 0, 0, 0, 0] as PayRow : [...(draft.pays[rank] ?? [0, 0, 0, 0, 0])] as PayRow]));
  return { id: payTableId({ familyId: draft.familyId, pays }), familyId: draft.familyId, pays, source: "manual" as const };
}

/** The built-in table with exactly these pays, if any. */
export const libraryMatch = (draft: DraftTable) => {
  const { id } = finalize(draft);
  return PAY_TABLE_LIBRARY.find(table => table.id === id) ?? null;
};
