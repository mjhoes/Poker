import { create } from "zustand";
import { aiKeySchema, aiSettingsSchema, aiUsageSchema, newId } from "@perfect-draw/shared";
import type { AiProvider, AiSettings } from "@perfect-draw/shared";
import { db } from "../data/db";
import { costFor } from "./models";

/*
 * API keys live in memory for the session by default. Only with "Remember key on this device" on are they written to
 * IndexedDB (unencrypted, as the settings warn). Keys are never in backups or logs.
 */
interface AiState { keys: Partial<Record<AiProvider, string>>; settings: AiSettings | null }
export const useAiStore = create<AiState>(() => ({ keys: {}, settings: null }));

const current = () => useAiStore.getState();
async function readSettings() {
  return aiSettingsSchema.parse(await db.records("aiSettings").get("local") ?? { id: "local", updatedAt: Date.now() });
}

/**
 * Key and settings operations run one at a time, in the order they were asked for. Without this, a load that read the
 * stored keys before a "Forget key" finished could write the forgotten key back into memory.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation);
  queue = run.catch(() => undefined);
  return run;
}

async function applyRemember(rememberKeys: boolean) {
  await db.transaction("rw", [db.records("aiSettings"), db.records("aiKeys")], async () => {
    const settings = await readSettings();
    await db.records("aiSettings").put({ ...settings, rememberKeys, updatedAt: Date.now() });
    await db.records("aiKeys").clear();
    if (rememberKeys) {
      for (const [provider, key] of Object.entries(current().keys)) {
        if (key) await db.records("aiKeys").put(aiKeySchema.parse({ provider, key, updatedAt: Date.now(), deletedAt: null }));
      }
    }
  });
  useAiStore.setState({ settings: await readSettings() });
}

export const aiService = {
  /** Loads settings, and remembered keys when that option is on. Keys already entered this session are kept. */
  load() {
    return serial(async () => {
      const settings = await readSettings();
      const stored = settings.rememberKeys ? await db.records("aiKeys").toArray() : [];
      useAiStore.setState({ settings, keys: { ...Object.fromEntries(stored.map(row => [row.provider, row.key])), ...current().keys } });
    });
  },
  keyFor(provider: AiProvider) { return current().keys[provider] ?? null; },
  setKey(provider: AiProvider, value: string) {
    const key = value.trim();
    if (!key) return Promise.reject(new Error("Enter a key."));
    if (/\s/.test(key)) return Promise.reject(new Error("A key has no spaces. Check that you pasted only the key."));
    return serial(async () => {
      useAiStore.setState({ keys: { ...current().keys, [provider]: key } });
      if ((await readSettings()).rememberKeys) await db.records("aiKeys").put(aiKeySchema.parse({ provider, key, updatedAt: Date.now(), deletedAt: null }));
    });
  },
  forgetKey(provider: AiProvider) {
    return serial(async () => {
      const keys = { ...current().keys };
      delete keys[provider];
      useAiStore.setState({ keys });
      await db.records("aiKeys").delete(provider);
    });
  },
  /** Turning remembering on stores the keys entered this session; turning it off deletes every stored key. */
  setRemember(rememberKeys: boolean) {
    return serial(() => applyRemember(rememberKeys));
  },
  updateSettings(changes: Partial<Pick<AiSettings, "coachProvider" | "coachTier" | "visionProvider" | "visionTier" | "fallbackEnabled" | "heuristicsProvider" | "mnemonicStyle">>) {
    return serial(async () => {
      const settings = { ...await readSettings(), ...changes, updatedAt: Date.now() };
      await db.records("aiSettings").put(aiSettingsSchema.parse(settings));
      useAiStore.setState({ settings: aiSettingsSchema.parse(settings) });
    });
  },
};

/** One row per provider call that used tokens, so the usage summary shows what testing has cost. */
export const usageService = {
  async log(entry: { provider: AiProvider; model: string; task: string; inputTokens: number; outputTokens: number }, requestedModel?: string) {
    const now = Date.now();
    const row = aiUsageSchema.parse({ id: newId(), ...entry, estCost: costFor(entry.model, entry.inputTokens, entry.outputTokens, requestedModel), createdAt: now, updatedAt: now, deletedAt: null });
    await db.records("aiUsage").add(row);
    return row;
  },
  async summary(since = 0) {
    const rows = (await db.records("aiUsage").where("createdAt").aboveOrEqual(since).toArray()).filter(row => row.deletedAt == null);
    const byModel = new Map<string, { provider: AiProvider; model: string; calls: number; inputTokens: number; outputTokens: number; cost: number }>();
    for (const row of rows) {
      const entry = byModel.get(row.model) ?? { provider: row.provider, model: row.model, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      entry.calls++; entry.inputTokens += row.inputTokens; entry.outputTokens += row.outputTokens; entry.cost += row.estCost;
      byModel.set(row.model, entry);
    }
    const models = [...byModel.values()].sort((a, b) => b.cost - a.cost);
    return { calls: rows.length, cost: models.reduce((sum, row) => sum + row.cost, 0), models };
  },
  async clear() { await db.records("aiUsage").clear(); },
};
