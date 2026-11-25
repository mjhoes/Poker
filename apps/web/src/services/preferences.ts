import { profileSchema, recentHandSchema } from "@perfect-draw/shared";
import type { RecentHand } from "@perfect-draw/shared";
import { db } from "../data/db";

type Prefs = ReturnType<typeof profileSchema.parse>["prefs"];
async function updatePrefs(changes: Partial<Prefs>) {
  await db.transaction("rw", db.records("profile"), async () => {
    const profile = profileSchema.parse(await db.records("profile").get("local"));
    await db.records("profile").put({ ...profile, updatedAt: Date.now(), prefs: { ...profile.prefs, ...changes } });
  });
}

/** Display preferences saved with the local profile (so they travel with backups). */
export const preferencesService = {
  async setDeckColors(deckColors: "two" | "four") { await updatePrefs({ deckColors }); },
  async setDealSpeed(dealSpeed: "relaxed" | "normal" | "fast") { await updatePrefs({ dealSpeed }); },
  /** Puts a hand first in the analyzer's recent list (the same cards, table and bet are not listed twice); keeps 20. */
  async addRecentHand(entry: Omit<RecentHand, "at">) {
    const next = recentHandSchema.parse({ ...entry, at: Date.now() });
    const same = (row: RecentHand) => row.paytableId === next.paytableId && row.coins === next.coins &&
      [...row.hand].sort((a, b) => a - b).join() === [...next.hand].sort((a, b) => a - b).join();
    await db.transaction("rw", db.records("profile"), async () => {
      const profile = profileSchema.parse(await db.records("profile").get("local"));
      const recentHands = [next, ...profile.prefs.recentHands.filter(row => !same(row))].slice(0, 20);
      await db.records("profile").put({ ...profile, updatedAt: Date.now(), prefs: { ...profile.prefs, recentHands } });
    });
  },
  async clearRecentHands() { await updatePrefs({ recentHands: [] }); },
};
