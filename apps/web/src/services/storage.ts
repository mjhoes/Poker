export type StorageStatus = "checking" | "persistent" | "best-effort" | "unavailable";
export async function requestPersistentStorage(): Promise<StorageStatus> {
  if (!navigator.storage?.persist) return "unavailable";
  try {
    if (await navigator.storage.persisted()) return "persistent";
    return await navigator.storage.persist() ? "persistent" : "best-effort";
  } catch { return "unavailable"; }
}
