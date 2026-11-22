import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { ENGINE_VERSION, GAME_FAMILIES, getGameFamily } from "@perfect-draw/engine";
import type { GameFamilyId, PayTable, ValueVector } from "@perfect-draw/engine";
import rawLibrary from "./library.json";

export { GAME_FAMILIES };

export interface LibraryPayTable extends PayTable {
  readonly slug: string;
  readonly name: string;
  /** Golden-test reference only; never substituted for a computed return. */
  readonly referenceReturnPct: number;
  readonly sources: readonly string[];
}

/** Stable canonical JSON: display names, source, and row insertion order excluded. */
export function payTableId(table: Pick<PayTable, "familyId" | "pays">): string {
  const family = getGameFamily(table.familyId);
  const rows = family.handRanks.map(rank => [rank, table.pays[rank] ?? (rank === "NOTHING" ? [0, 0, 0, 0, 0] : null)]);
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify({ familyId: family.id, rows }))));
}

export function analysisKey(familyId: GameFamilyId, valueVector: ValueVector, betCoins = 1): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify({ engineVersion: ENGINE_VERSION, familyId, valueVector, betCoins }))));
}

export const PAY_TABLE_LIBRARY: readonly LibraryPayTable[] = Object.freeze(rawLibrary.map(entry => {
  const familyId = entry.familyId as GameFamilyId;
  const family = getGameFamily(familyId);
  if (entry.maxCoinPerCoin.length !== family.handRanks.length) throw new Error(`Invalid library table: ${entry.slug}`);
  const pays = Object.fromEntries(family.handRanks.map((rank, index) => {
    const value = entry.maxCoinPerCoin[index];
    // Royal pays 250/coin at bets 1–4 and 800/coin at five; others linear.
    const lowCoin = rank === "ROYAL_FLUSH" || rank === "NATURAL_ROYAL" ? 250 : value;
    return [rank, Object.freeze([lowCoin, lowCoin * 2, lowCoin * 3, lowCoin * 4, value * 5])];
  })) as PayTable["pays"];
  return Object.freeze({
    id: payTableId({ familyId, pays }), slug: entry.slug, name: entry.name,
    familyId, pays: Object.freeze(pays), source: "library" as const,
    referenceReturnPct: entry.referenceReturnPct, sources: Object.freeze([...entry.sources]),
  });
}));

export function getLibraryPayTable(idOrSlug: string): LibraryPayTable {
  const result = PAY_TABLE_LIBRARY.find(table => table.id === idOrSlug || table.slug === idOrSlug);
  if (!result) throw new Error(`Unknown library pay table: ${idOrSlug}`);
  return result;
}
