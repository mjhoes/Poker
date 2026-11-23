import { useEffect, useState } from "react";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { loadPrecomputedManifest } from "@perfect-draw/precomputed";
import type { Machine, MachineDraft } from "@perfect-draw/shared";
import { familyName, money } from "../components/UiHelpers";

export const libraryTable = (paytableId: string) => PAY_TABLE_LIBRARY.find(table => table.id === paytableId);

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
  { slug: "jacks-or-better-9-6", blurb: "The classic. Simple strategy, 99.5% return." },
  { slug: "double-double-bonus-9-6", blurb: "Big quad bonuses, higher swings." },
  { slug: "deuces-wild-full-pay", blurb: "Wild deuces. Over 100% with perfect play." },
] as const;

export function starterDraft(slug: string, walletId: string): MachineDraft | null {
  const table = PAY_TABLE_LIBRARY.find(item => item.slug === slug);
  if (!table) return null;
  return {
    name: defaultMachineName(table.id, 25, 1), paytableId: table.id, variant: { kind: "standard", config: {} },
    denominationCents: 25, coins: 5, lines: 1, theme: slug.startsWith("double") ? "midnight" : slug.startsWith("deuces") ? "royal" : "felt",
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
  const [returns, setReturns] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    returnsPromise ??= loadPrecomputedManifest({ fetch: (input: RequestInfo | URL) => fetch(input) })
      .then(manifest => new Map(manifest.entries.map(entry => [entry.paytableId, entry.returnPct])))
      .catch(() => { returnsPromise = null; return new Map<string, number>(); });
    void returnsPromise.then(map => { if (!cancelled) setReturns(map); });
    return () => { cancelled = true; };
  }, []);
  return returns;
}
