import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPersistentStorage } from "../src/services/storage";
afterEach(() => vi.unstubAllGlobals());
describe("browser persistence request", () => {
  it("requests persistence when supported and not yet granted", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist } });
    expect(await requestPersistentStorage()).toBe("persistent");
    expect(persist).toHaveBeenCalledOnce();
  });
  it("reports denial honestly", async () => {
    vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist: async () => false } });
    expect(await requestPersistentStorage()).toBe("best-effort");
  });
  it("handles unsupported browsers and denied access without losing the app", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestPersistentStorage()).toBe("unavailable");
    vi.stubGlobal("navigator", { storage: { persist: () => { throw new Error("denied"); } } });
    expect(await requestPersistentStorage()).toBe("unavailable");
  });
  it("does not request twice if already persistent", async () => {
    const persist = vi.fn();
    vi.stubGlobal("navigator", { storage: { persisted: async () => true, persist } });
    expect(await requestPersistentStorage()).toBe("persistent");
    expect(persist).not.toHaveBeenCalled();
  });
});
