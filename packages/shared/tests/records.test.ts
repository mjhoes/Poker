import { describe, expect, it } from "vitest";
import { machineDraftSchema, newId, recordSchemas, sessionSchema, sessionStateSchema, walletTransferSchema } from "../src";

describe("local record contracts", () => {
  it("creates monotonic UUIDv7 entity IDs", () => {
    const ids = Array.from({ length: 100 }, newId);
    expect(new Set(ids).size).toBe(100);
    expect(ids.every(x => x[14] === "7")).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });
  it("gives every record sync metadata", () => {
    for (const schema of Object.values(recordSchemas)) {
      expect(schema.shape).toHaveProperty("updatedAt");
      expect(schema.shape).toHaveProperty("deletedAt");
    }
  });
  it("defaults machine and session variants to standard", () => {
    const draft = machineDraftSchema.parse({ name: "Home table", paytableId: "a".repeat(64), denominationCents: 25, defaultWalletId: newId() });
    expect(draft.variant).toEqual({ kind: "standard", config: {} });
    const session = sessionSchema.parse({ id: newId(), updatedAt: 0, machineId: newId(), walletId: draft.defaultWalletId, machineSnapshot: draft, state: {}, startedAt: 0 });
    expect(session.variant.kind).toBe("standard");
    expect(session.state.variantState).toEqual({});
    expect(session.deletedAt).toBeNull();
  });
  it("rejects duplicate cards, invalid masks and unsafe currency", () => {
    expect(sessionStateSchema.safeParse({ hand: [1, 1, 2, 3, 4] }).success).toBe(false);
    expect(sessionStateSchema.safeParse({ hand: [], heldMask: 1 }).success).toBe(false);
    expect(walletTransferSchema.safeParse({ fromId: newId(), toId: newId(), amountCents: 1.1 }).success).toBe(false);
    expect(walletTransferSchema.safeParse({ fromId: newId(), toId: newId(), amountCents: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });
});
