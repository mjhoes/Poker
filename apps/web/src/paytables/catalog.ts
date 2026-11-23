import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { GameFamilyId } from "@perfect-draw/engine";
import { useAppStore } from "../state/app-store";

export type PaytableInfo = {
  id: string; name: string; familyId: GameFamilyId; pays: Readonly<Record<string, readonly number[]>>;
  source: "library" | "photo" | "manual"; slug?: string;
};

/**
 * One lookup for every pay table, built in or entered by hand. Custom tables come from the app store, which follows
 * the database live; pass `custom` explicitly where a component already subscribed to it.
 */
export function findPaytable(id: string, custom = useAppStore.getState().paytables): PaytableInfo | undefined {
  const library = PAY_TABLE_LIBRARY.find(table => table.id === id);
  if (library) return { id: library.id, name: library.name, familyId: library.familyId, pays: library.pays, source: "library", slug: library.slug };
  const row = custom.find(table => table.id === id);
  return row ? { id: row.id, name: row.name, familyId: row.familyId as GameFamilyId, pays: row.pays, source: row.source } : undefined;
}

/** All selectable tables: the library first, then the player's own, oldest first. */
export function useAllPaytables(): PaytableInfo[] {
  const custom = useAppStore(state => state.paytables);
  return [
    ...PAY_TABLE_LIBRARY.map(table => ({ id: table.id, name: table.name, familyId: table.familyId, pays: table.pays, source: "library" as const, slug: table.slug })),
    ...custom.map(row => ({ id: row.id, name: row.name, familyId: row.familyId as GameFamilyId, pays: row.pays, source: row.source })),
  ];
}
