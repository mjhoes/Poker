import { getGameFamily } from "./families";
import type { GameFamilyId } from "./types";

const NAMES: Record<string, string> = {
  RF: "Royal Flush", SF: "Straight Flush", "4K": "Four of a kind", FH: "Full House",
  FL: "Flush", ST: "Straight", "3K": "Three of a kind", "2P": "Two pair",
  HP: "High pair (Jacks or better)", LP: "Low pair (Tens or lower)",
  HP_A: "Pair of Aces", LP_234: "Pair of 2s, 3s, or 4s", LP_5T: "Pair of 5s through Tens",
  "3K_A": "Three Aces", "3K_234": "Three 2s, 3s, or 4s", "3K_5K": "Three 5s through Kings",
  "3K_A_w234": "Three Aces with a held 2, 3, or 4 kicker",
  "3K_234_wA234": "Three 2s, 3s, or 4s with a held Ace, 2, 3, or 4 kicker",
  "2P_A": "Two pair including Aces",
  "4D": "Four deuces", WRF: "Wild Royal Flush", "5K": "Five of a kind",
  DRAW5: "Discard all five cards", HIGH_CARD: "High-card hand",
  "4RF": "4 to a Royal Flush", "4FL": "4 to a Flush",
  "4K_A": "Four Aces", "4K_234": "Four 2s, 3s, or 4s", "4K_5K": "Four 5s through Kings",
  "4K_A_w234": "Four Aces with a 2, 3, or 4 kicker",
  "4K_234_wA234": "Four 2s, 3s, or 4s with an Ace, 2, 3, or 4 kicker",
};
const RANK_NAMES: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten" };
const ranks = (text: string) => [...text].map(rank => RANK_NAMES[rank] ?? rank).join("–");
const highCards = (count: string) => `${count} high card${count === "1" ? "" : "s"}`;

/** Human-readable names for atomic, penalty-refined, and grouped chart labels. */
export function describeLabel(label: string, familyId: GameFamilyId): string {
  getGameFamily(familyId);
  if (label.includes(" / ")) return "First available: " + label.split(" / ").map(part => describeLabel(part, familyId)).join("; ");
  const [head, ...modifiers] = label.split("|"), details: string[] = [];
  const wild = head.match(/^D([0-4])_(.+)$/);
  if (wild && familyId !== "deuces_wild") throw new Error("Deuces label used with a non-Deuces family.");
  const base = wild?.[2] ?? head;
  const count = wild ? Number(wild[1]) : undefined;
  let name = NAMES[base], match: RegExpMatchArray | null;
  if (base === "HP" && (familyId === "bonus_poker" || familyId === "double_bonus" || familyId === "double_double_bonus")) {
    name = "Pair of Jacks, Queens, or Kings";
  }
  if (base === "LP" && familyId === "deuces_wild") name = "Pair of 3s through Tens";
  if (base === "ONLY" && count !== undefined && count > 0) {
    name = `${["", "One deuce", "Two deuces", "Three deuces", "Four deuces"][count]} only`;
  } else if ((match = base.match(/^3RF_h([0-3])(?:_w([1-9])_d([01]))?$/))) {
    name = "3 to a Royal Flush"; details.push(highCards(match[1]));
    if (match[2]) details.push(`${match[2]} straight patterns`, match[3] === "1" ? "low-end draw" : "no low-end pattern");
  } else if ((match = base.match(/^([34])RF_w([1-9])_d([01])$/))) {
    name = `${match[1]} to a Royal Flush`; details.push(`${match[2]} straight patterns`, match[3] === "1" ? "low-end draw" : "no low-end pattern");
  } else if ((match = base.match(/^2RF_([2-9TJQKA]{1,2})$/))) {
    name = "2 to a Royal Flush"; details.push(ranks(match[1]));
  } else if ((match = base.match(/^4(SF|ST)_(open|inside)(?:_h([0-4]))?$/))) {
    name = `4 to an ${match[2] === "open" ? "Open-Ended" : "Inside"} ${match[1] === "SF" ? "Straight Flush" : "Straight"}`;
    if (match[3] !== undefined) details.push(highCards(match[3]));
  } else if ((match = base.match(/^3SF_t([1-3])$/))) {
    name = "3 to a Straight Flush"; details.push(`type ${match[1]}`);
  } else if ((match = base.match(/^([234])(SF|ST)_g([0-4])_h([0-4])_w([1-9]|10)(?:_d([01]))?$/))) {
    name = `${match[1]} to a ${match[2] === "SF" ? "Straight Flush" : "Straight (no flush)"}`;
    details.push(`${match[3]} gap${match[3] === "1" ? "" : "s"}`, highCards(match[4]), `${match[5]} straight pattern${match[5] === "1" ? "" : "s"}`);
    if (match[6]) details.push(match[6] === "1" ? "low-end draw" : "no low-end pattern");
  } else if ((match = base.match(/^([34])(SF|ST)_g([0-4])_w([1-9])_d([01])$/))) {
    name = `${match[1]} to a ${match[2] === "SF" ? "Straight Flush" : "Straight (no flush)"}`;
    details.push(`${match[3]} gap${match[3] === "1" ? "" : "s"}`, `${match[4]} straight patterns`,
      match[5] === "1" ? "low-end draw" : "no low-end pattern");
  } else if ((match = base.match(/^3FL_h([0-3])$/))) {
    name = "3 to a Flush"; details.push(highCards(match[1]));
  } else if ((match = base.match(/^([AKQJT]{2,3})_unsuited$/))) {
    name = `Unsuited ${match[1]}`;
  } else if ((match = base.match(/^1H_([AKQJ])$/))) {
    name = `Single ${ranks(match[1])}`;
  } else if ((match = base.match(/^OTHER_([1-4])$/))) {
    name = `Hold ${match[1]} card${match[1] === "1" ? "" : "s"}`; details.push("other pattern");
  }
  if (!name) throw new Error(`Unknown hold label: ${label}`);
  if (base === "RF" && familyId === "deuces_wild") name = "Natural Royal Flush";
  if (count !== undefined && base !== "ONLY" && base !== "4D") {
    details.push(count === 0 ? "no deuces held" : count === 1 ? "one deuce held" : `${count} deuces held`);
  }
  const hasCounts = modifiers.some(modifier => modifier.startsWith("p:"));
  for (const modifier of modifiers) {
    if (modifier.startsWith("pen:")) {
      const penalties = modifier.slice(4);
      if (!/^(none|flush|straight|flush,straight)$/.test(penalties)) throw new Error("Invalid penalty label.");
      if (!hasCounts) details.push(penalties === "none" ? "no penalty cards"
        : penalties.split(",").map(penalty => `${penalty} penalty`).join(", "));
    } else if (/^[rd]:[2-9TJQKA]*$/.test(modifier)) {
      details.push(`${modifier[0] === "r" ? "held" : "discarded"} ranks ${modifier.slice(2) || "none"}`);
    } else if ((match = modifier.match(/^p:([0-5]),([0-5])$/))) {
      if (match[1] === "0" && match[2] === "0") details.push("no flush or straight penalty cards");
      else {
        if (match[1] !== "0") details.push(`${match[1]} flush penalty card${match[1] === "1" ? "" : "s"}`);
        if (match[2] !== "0") details.push(`${match[2]} straight penalty card${match[2] === "1" ? "" : "s"}`);
      }
    } else throw new Error("Unknown label modifier.");
  }
  return name + (details.length ? ` (${details.join("; ")})` : "");
}
