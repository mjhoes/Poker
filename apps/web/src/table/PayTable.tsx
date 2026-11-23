import { getGameFamily } from "@perfect-draw/engine";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";

const SHORT_NAMES: Record<string, string> = {
  ROYAL_FLUSH: "Royal Flush", NATURAL_ROYAL: "Natural Royal", FOUR_DEUCES: "Four Deuces", WILD_ROYAL: "Wild Royal",
  FIVE_KIND: "Five of a Kind", STRAIGHT_FLUSH: "Straight Flush", FOUR_KIND: "4 of a Kind",
  FOUR_ACES_W_234: "4 Aces + 2–4", FOUR_234_W_A234: "4 2–4s + A–4", FOUR_ACES: "4 Aces", FOUR_234: "4 2s–4s", FOUR_5K: "4 5s–Ks",
  FULL_HOUSE: "Full House", FLUSH: "Flush", STRAIGHT: "Straight", THREE_KIND: "3 of a Kind", TWO_PAIR: "Two Pair",
  JACKS_OR_BETTER: "Jacks or Better",
};
export const shortRankName = (rank: string) => SHORT_NAMES[rank] ?? rank.replaceAll("_", " ").toLowerCase();

/**
 * The machine's pay table, as printed on the glass: one row per paying hand, one column per coin bet. The column for
 * the current bet is lit, and rows hit by the last draw glow. Split into two panels so it stays short.
 */
export function PayTable({ paytableId, coins, hits }: { paytableId: string; coins: number; hits: ReadonlySet<string> }) {
  const table = PAY_TABLE_LIBRARY.find(item => item.id === paytableId);
  if (!table) return null;
  const ranks = getGameFamily(table.familyId).handRanks.filter(rank => rank !== "NOTHING");
  const half = Math.ceil(ranks.length / 2);
  const panels = [ranks.slice(0, half), ranks.slice(half)];
  return <div className="paytable" aria-label={`${table.name} pay table`} role="region">
    {panels.map((rows, panel) => <table key={panel} className="paytable-panel">
      <caption className="visually-hidden">{table.name} pays, part {panel + 1} of 2</caption>
      <thead><tr><th scope="col">Hand</th>{[1, 2, 3, 4, 5].map(column => <th key={column} scope="col" className={column === coins ? "is-bet" : ""}>{column}<span className="visually-hidden"> coin{column === 1 ? "" : "s"}</span></th>)}</tr></thead>
      <tbody>{rows.map(rank => <tr key={rank} className={hits.has(rank) ? "is-hit" : ""}>
        <th scope="row">{shortRankName(rank)}</th>
        {[1, 2, 3, 4, 5].map(column => <td key={column} className={column === coins ? "is-bet" : ""}>{(table.pays[rank]?.[column - 1] ?? 0).toLocaleString("en-US")}</td>)}
      </tr>)}</tbody>
    </table>)}
  </div>;
}
