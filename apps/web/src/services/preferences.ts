import { profileSchema } from "@perfect-draw/shared";
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
};
