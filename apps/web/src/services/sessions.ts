import { machineDraftSchema, newId, sessionActionSchema, sessionSchema, sessionStartSchema, uuid } from "@perfect-draw/shared";
import type { Session, SessionService } from "@perfect-draw/shared";
import { db, live, requireRecord, stamp } from "../data/db";

export const sessionService: SessionService = {
  async list() { return (await db.records("sessions").toArray()).filter(live).map(x => sessionSchema.parse(x)); },
  async start(input: unknown) {
    const parsed = sessionStartSchema.parse(input);
    if (!["free_play", "drill"].includes(parsed.mode)) throw new Error("This training mode is not available yet.");
    return db.transaction("rw", [db.records("machines"), db.records("wallets"), db.records("sessions"), db.records("profile")], async () => {
      const machine = await requireRecord("machines", parsed.machineId);
      const wallet = await requireRecord("wallets", parsed.walletId ?? machine.defaultWalletId);
      const session = sessionSchema.parse({
        id: newId(), ...stamp(), machineId: machine.id, walletId: wallet.id, mode: parsed.mode,
        machineSnapshot: machineDraftSchema.parse(machine), variant: machine.variant, startedAt: Date.now(),
        state: { credits: wallet.balanceCents / machine.denominationCents },
      });
      await db.records("sessions").add(session);
      await setActiveInTransaction(session.id);
      return session;
    });
  },
  async activate(id: string) {
    uuid.parse(id);
    return db.transaction("rw", [db.records("sessions"), db.records("profile")], async () => {
      const session = await requireRecord("sessions", id);
      if (session.status === "closed") throw new Error("This session is closed.");
      await setActiveInTransaction(id);
    });
  },
  async pause(id: string) { return changeStatus(id, "paused"); },
  async resume(id: string) { return changeStatus(id, "active"); },
  async close(id: string) { return changeStatus(id, "closed"); },
  async applyAction(id: string, input: unknown) {
    uuid.parse(id); const action = sessionActionSchema.parse(input);
    return db.transaction("rw", db.records("sessions"), async () => {
      const current = await requireRecord("sessions", id);
      if (current.status !== "active") throw new Error("Resume the session before changing it.");
      if (action.type === "hold" && current.state.phase !== "holding") throw new Error("There is no hand to hold.");
      const state = action.type === "hold" ? { ...current.state, heldMask: action.heldMask }
        : { ...current.state, hand: action.hand, heldMask: action.heldMask, phase: "holding" };
      const next = sessionSchema.parse({ ...current, state, updatedAt: Date.now() });
      await db.records("sessions").put(next); return next;
    });
  },
};
async function setActiveInTransaction(id: string | null) {
  const profile = await requireRecord("profile", "local");
  await db.records("profile").put({ ...profile, updatedAt: Date.now(), prefs: { ...profile.prefs, activeSessionId: id } });
}
async function changeStatus(id: string, status: Session["status"]) {
  uuid.parse(id);
  return db.transaction("rw", [db.records("sessions"), db.records("profile")], async () => {
    const session = await requireRecord("sessions", id);
    if (session.status === "closed") throw new Error("This session is already closed.");
    const next = sessionSchema.parse({ ...session, status, endedAt: status === "closed" ? Date.now() : null, updatedAt: Date.now() });
    await db.records("sessions").put(next);
    if (status === "closed") {
      const profile = await requireRecord("profile", "local");
      if (profile.prefs.activeSessionId === id) {
        const remaining = (await db.records("sessions").toArray()).find(x => live(x) && x.status !== "closed" && x.id !== id);
        await setActiveInTransaction(remaining?.id ?? null);
      }
    }
    return next;
  });
}
