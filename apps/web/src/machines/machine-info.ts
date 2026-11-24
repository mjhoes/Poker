import { useEffect, useState } from "react";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { loadPrecomputedManifest } from "@perfect-draw/precomputed";
import type { Machine, MachineDraft } from "@perfect-draw/shared";
import { familyName, money } from "../components/UiHelpers";
import { findPaytable } from "../paytables/catalog";
import { useAppStore } from "../state/app-store";

export const libraryTable = (paytableId: string) => findPaytable(paytableId);

/** "25¢" below a dollar, "$1" or "$2.50" above. */
export const denominationLabel = (cents: number) => cents < 100 ? `${cents}¢` : money(cents).replace(/\.00$/, "");

/** A name people would actually use: "9/6 Jacks or Better · 25¢ · 3-play". */
export function defaultMachineName(paytableId: string, denominationCents: number, lines: number) {
  const table = libraryTable(paytableId);
  return [table?.name ?? "Custom game", denominationLabel(denominationCents), lines > 1 ? `${lines}-play` : ""].filter(Boolean).join(" · ");
}

export const gameLabel = (paytableId: string) => {
  const table = libraryTable(paytableId);
  return { table: table?.name ?? "Custom pay table", family: table ? familyName(table.familyId) : "Custom game" };
};

/** Suggested first machines, one click each. */
export const STARTER_MACHINES = [
  { slug: "jacks-or-better-9-6", blurb: "The classic. Simple strategy, 99.5% return.", theme: "felt" },
  { slug: "double-double-bonus-9-6", blurb: "Big quad bonuses, higher swings.", theme: "midnight" },
  { slug: "deuces-wild-full-pay", blurb: "Wild deuces. Over 100% with perfect play.", theme: "royal" },
  { slug: "bonus-poker-8-5", blurb: "Jacks or Better with bonus quads: four aces pay 80. Common on floors.", theme: "ocean" },
  { slug: "bonus-poker-deluxe-9-6", blurb: "Every four of a kind pays 80, but two pair pays only 1.", theme: "classic" },
  { slug: "double-bonus-10-7", blurb: "Over 100% with perfect play; two pair pays only 1. Big swings.", theme: "onyx" },
  { slug: "deuces-wild-nsud", blurb: "\"Not So Ugly Ducks\": five of a kind 16, straight flush 10. 99.7%.", theme: "royal" },
] as const;
export type StarterSlug = typeof STARTER_MACHINES[number]["slug"];

export function starterDraft(slug: string, walletId: string): MachineDraft | null {
  const table = PAY_TABLE_LIBRARY.find(item => item.slug === slug);
  if (!table) return null;
  return {
    name: defaultMachineName(table.id, 25, 1), paytableId: table.id, variant: { kind: "standard", config: {} },
    denominationCents: 25, coins: 5, lines: 1, theme: STARTER_MACHINES.find(starter => starter.slug === slug)?.theme ?? "felt",
    speed: "normal", defaultWalletId: walletId, casinoName: "", location: "", notes: "",
  };
}

export function draftFrom(machine: Machine, overrides: Partial<MachineDraft> = {}): MachineDraft {
  const { name, paytableId, variant, denominationCents, coins, lines, theme, speed, defaultWalletId, casinoName, location, notes } = machine;
  return { name, paytableId, variant, denominationCents, coins, lines, theme, speed, defaultWalletId, casinoName, location, notes, ...overrides };
}

let returnsPromise: Promise<Map<string, number>> | null = null;
/**
 * Computed max-bet returns for the library pay tables, read from the precomputed manifest (a small JSON file the
 * service worker caches). Engine-computed figures only; nothing is shown if the manifest cannot be read.
 */
export function useLibraryReturns() {
  const custom = useAppStore(state => state.paytables);
  const [library, setReturns] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    returnsPromise ??= loadPrecomputedManifest({ fetch: (input: RequestInfo | URL) => fetch(input) })
      .then(manifest => new Map(manifest.entries.map(entry => [entry.paytableId, entry.returnPct])))
      .catch(() => { returnsPromise = null; return new Map<string, number>(); });
    void returnsPromise.then(map => { if (!cancelled) setReturns(map); });
    return () => { cancelled = true; };
  }, []);
  // Custom tables carry the return the engine computed when they were saved.
  const returns = new Map(library);
  for (const table of custom) if (table.computed) returns.set(table.id, table.computed.returnPct);
  return returns;
}
