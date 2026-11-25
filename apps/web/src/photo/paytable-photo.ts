import * as z from "zod/v4";
import type { GameFamilyId } from "@perfect-draw/engine";
import { familyName, handRankName } from "../components/UiHelpers";
import { isRoyal, linearRow, matchAnyRank, matchRank, payingRanks } from "../paytables/model";
import type { DraftTable, Issue, PayRow } from "../paytables/model";

/*
 * Pay table photos: the model only transcribes what is printed (row labels, the pays in each coin column, how sure it
 * is). Everything after that is ours and deterministic: which game it is, which hand each label means, filling columns
 * the photo doesn't show, and the checks. Unrecognized labels are handed to the player, never guessed.
 */

export const paytableReplySchema = z.object({
  readable: z.boolean(),
  rows: z.array(z.object({
    label: z.string(),
    /** Pays for 1, 2, 3, 4 and 5 coins, left to right; null where a column isn't shown or can't be read. */
    pays: z.array(z.number().nullable()),
    confidence: z.number(),
  })),
  gameGuess: z.string().nullable(),
  multiplierGame: z.string().nullable(),
  denominationCents: z.number().nullable(),
  lines: z.number().nullable(),
});
export type PaytableReply = z.infer<typeof paytableReplySchema>;

export const PAYTABLE_SYSTEM = [
  "You read video poker pay tables from photos of machines. Transcribe exactly what is printed; do not correct, infer or",
  "complete anything.",
  "",
  "- rows: one per hand listed on the pay table, top to bottom. label: the hand's name as printed (e.g. \"4 ACES W/2,3,4\").",
  "  pays: five entries for 1, 2, 3, 4 and 5 coins bet, left to right; use null for a column that isn't shown or that you",
  "  can't read. If only one column is visible, put its numbers in the column it belongs to (null elsewhere).",
  "  confidence: 0 to 1, how sure you are of that row's label and numbers.",
  "- gameGuess: the game's name if printed or obvious (e.g. \"Double Double Bonus Poker\"), else null.",
  "- multiplierGame: if this is Ultimate X, Super Times Pay, Multi-Strike or another multiplier game, its name; else null.",
  "- denominationCents and lines: only if shown on screen, else null.",
  "- readable: false if there is no pay table in the photo; then rows is empty.",
].join("\n");
export const PAYTABLE_PROMPT = "Transcribe the video poker pay table in this photo.";

/** Hands whose presence settles the game; the model's guess only breaks ties. */
function detectFamily(found: { rank: string; pays: (number | null)[] }[], guess: string | null): GameFamilyId {
  const has = (rank: string) => found.some(row => row.rank === rank);
  const perCoin = (rank: string) => {
    const row = found.find(item => item.rank === rank)?.pays ?? [];
    const first = row.findIndex(value => value != null && value > 0);
    return first < 0 ? 0 : (row[first] as number) / (first + 1);
  };
  if (["FOUR_DEUCES", "WILD_ROYAL", "FIVE_KIND", "NATURAL_ROYAL"].some(has)) return "deuces_wild";
  if (has("FOUR_ACES_W_234") || has("FOUR_234_W_A234")) return "double_double_bonus";
  if (has("FOUR_ACES") || has("FOUR_234") || has("FOUR_5K")) return perCoin("FOUR_ACES") >= 160 ? "double_bonus" : "bonus_poker";
  if (has("FOUR_KIND")) return perCoin("FOUR_KIND") >= 50 ? "bonus_poker_deluxe" : "jacks_or_better";
  const text = (guess ?? "").toLowerCase();
  const byName = (["double_double_bonus", "bonus_poker_deluxe", "double_bonus", "bonus_poker", "deuces_wild", "jacks_or_better"] as GameFamilyId[])
    .find(id => text.includes(familyName(id).toLowerCase().replace(/ poker$/, "")));
  return byName ?? "jacks_or_better";
}

/** A row from the visible columns: all five as printed, else scaled from the 1-coin (or 5-coin) column. */
function completeRow(rank: string, pays: (number | null)[]): { row: PayRow; filled: boolean } {
  const columns = [0, 1, 2, 3, 4].map(index => {
    const value = pays[index];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  });
  if (columns.every(value => value !== null)) return { row: columns as PayRow, filled: false };
  const first = columns.findIndex(value => value !== null);
  if (first < 0) return { row: [0, 0, 0, 0, 0], filled: true };
  const perCoin = Math.round((columns[first] as number) / (first + 1));
  const base = first === 4 && isRoyal(rank) ? linearRow(rank, (columns[4] as number) >= 2000 ? 250 : perCoin, columns[4] as number) : linearRow(rank, perCoin);
  return { row: base.map((value, index) => columns[index] ?? value) as PayRow, filled: true };
}

export interface PhotoReading {
  familyId: GameFamilyId; draft: DraftTable;
  /** Hands to double-check: low confidence, columns filled in, or read twice. */ doubtful: string[];
  /** Printed rows we couldn't match to a hand of this game; the player assigns them. */ unknown: { label: string; pays: PayRow }[];
  /** Hands the game has that the photo didn't show. */ missing: string[];
  issues: Issue[]; multiplierGame: string | null; denominationCents: number | null; lines: number | null;
}

const LOW_CONFIDENCE = 0.8;

/** The photo's rows as a draft of the detected game, or of `familyOverride` when the player picks the game. */
export function readPaytable(reply: PaytableReply, familyOverride?: GameFamilyId): PhotoReading {
  const rows = reply.rows.map(row => ({ ...row, rank: matchAnyRank(row.label) }));
  const familyId = familyOverride ?? detectFamily(rows.filter(row => row.rank) as { rank: string; pays: (number | null)[] }[], reply.gameGuess);
  const ranks = payingRanks(familyId);
  const pays = Object.fromEntries(ranks.map(rank => [rank, [0, 0, 0, 0, 0] as PayRow]));
  const doubtful = new Set<string>(), seen = new Set<string>();
  const unknown: PhotoReading["unknown"] = [];
  for (const row of reply.rows) {
    const rank = matchRank(row.label, familyId);
    const { row: values, filled } = completeRow(rank ?? "", row.pays);
    if (!rank) { unknown.push({ label: row.label, pays: values }); continue; }
    if (seen.has(rank) || filled || row.confidence < LOW_CONFIDENCE) doubtful.add(rank);
    seen.add(rank);
    pays[rank] = values;
  }
  const missing = ranks.filter(rank => !seen.has(rank));
  const draft: DraftTable = { familyId, pays };
  return {
    familyId, draft, doubtful: [...doubtful], unknown, missing, issues: photoChecks(draft, missing),
    multiplierGame: reply.multiplierGame?.trim() || null,
    denominationCents: reply.denominationCents != null && reply.denominationCents > 0 ? Math.round(reply.denominationCents) : null,
    lines: reply.lines != null && reply.lines >= 1 ? Math.round(reply.lines) : null,
  };
}

/** Checks for a photographed table (F2.2), on top of the editor's own: missing hands, columns, an unusual royal. */
export function photoChecks(draft: DraftTable, missing: readonly string[] = []): Issue[] {
  const issues: Issue[] = missing.map(rank => ({ rank, level: "warning" as const, message: `${handRankName(rank)} wasn't found in the photo. Enter its pays.` }));
  for (const rank of payingRanks(draft.familyId)) {
    const row = draft.pays[rank];
    if (!row || missing.includes(rank)) continue;
    const linear = row.every((value, index) => value === row[0] * (index + 1));
    if (isRoyal(rank)) {
      if (row[4] > 0 && (row[4] < 1000 || row[4] > 10000)) issues.push({ rank, level: "warning", message: `${handRankName(rank)} pays ${row[4].toLocaleString("en-US")} at 5 coins; it is usually 4,000. Check the photo.` });
      if (!row.slice(0, 4).every((value, index) => value === row[0] * (index + 1))) issues.push({ rank, level: "warning", message: `${handRankName(rank)}'s 1–4 coin pays don't go up evenly. Check the photo.` });
    } else if (!linear) issues.push({ rank, level: "warning", message: `${handRankName(rank)}'s columns aren't 1×–5× the 1-coin pay. Check the photo.` });
  }
  return issues;
}

/** The ranks a printed label could be assigned to in this game (for unknown rows). */
export const assignableRanks = (familyId: GameFamilyId) => payingRanks(familyId);
