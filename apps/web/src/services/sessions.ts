import { fixedBet } from "./bet";
import { machineDraftSchema, newId, sessionActionSchema, sessionSchema, sessionStartSchema, uuid } from "@perfect-draw/shared";
import type { Session, SessionService } from "@perfect-draw/shared";
import { standardVariant } from "@perfect-draw/engine";
import { analysisKey } from "@perfect-draw/paytables";
import { db, live, requireRecord, stamp } from "../data/db";
import { creditState } from "./money";

export const sessionService: SessionService = {
  async list() { return (await db.records("sessions").toArray()).filter(live).map(x => sessionSchema.parse(x)); },
  async start(input: unknown) {
    const parsed = sessionStartSchema.parse(input);
    if (!["free_play", "drill"].includes(parsed.mode)) throw new Error("This training mode is not available yet.");
    return db.transaction("rw", [db.records("machines"), db.records("wallets"), db.records("sessions"), db.records("profile"), db.records("paytables")], async () => {
      const machine = await requireRecord("machines", parsed.machineId);
      const wallet = await requireRecord("wallets", parsed.walletId ?? machine.defaultWalletId);
      if (parsed.trainingFocus) {
        const table = await requireRecord("paytables", machine.paytableId);
        if (parsed.trainingFocus.analysisKey !== analysisKey(table.familyId, standardVariant.valueVector(table, machine.coins, {}), machine.coins)) throw new Error("Machine terms changed. Select training again.");
      }
      const session = sessionSchema.parse({
        id: newId(), ...stamp(), machineId: machine.id, walletId: wallet.id, mode: parsed.mode,
        machineSnapshot: machineDraftSchema.parse(machine), variant: machine.variant, startedAt: Date.now(),
        trainingFocus: parsed.trainingFocus ?? null, pace: parsed.pace ?? null, training: parsed.training ?? null,
        state: { ...creditState(wallet.balanceCents, machine.denominationCents), ...(parsed.feedbackMode ? { feedbackMode: parsed.feedbackMode } : {}) },
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
      if (action.type === "feedback") {
        const next = sessionSchema.parse({ ...current, updatedAt: Date.now(), state: { ...current.state, feedbackMode: action.feedbackMode, warning: null } });
        await db.records("sessions").put(next); return next;
      }
      if (action.type === "bet") {
        // A dealt hand keeps the bet it was paid with; the new bet applies from the next deal.
        if (current.state.handId && current.state.phase === "holding") throw new Error("Finish this hand before changing the bet.");
        const fixed = fixedBet(current);
        if (fixed !== null && action.coins !== fixed) throw new Error(current.trainingFocus ? "A focused drill keeps the bet it was set up for." : "The Strategy Ladder deals at 5 coins: strategy charts are for max bet.");
        const next = sessionSchema.parse({ ...current, updatedAt: Date.now(), state: { ...current.state, betCoins: action.coins } });
        await db.records("sessions").put(next); return next;
      }
      if (action.type === "hold" && current.state.phase !== "holding") throw new Error("There is no hand to hold.");
      if (action.type === "hold" && action.handId !== undefined && action.handId !== current.state.handId) throw new Error("This hand is no longer current.");
      if (action.type === "saveHand" && current.state.handId) throw new Error("Use the game loop to change a dealt hand.");
      const state = action.type === "hold" ? { ...current.state, heldMask: action.heldMask, warning: action.heldMask === current.state.heldMask ? current.state.warning : null }
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
    if (status === session.status) return session;
    if (status === "closed" && session.mode === "free_play" && session.state.handId && session.state.phase === "holding") throw new Error("Finish the paid hand before closing this session.");
    const now = Date.now();
    const state = { ...session.state };
    if (state.phase === "holding") {
      if (status === "paused" && state.decisionStartedAt !== null) {
        state.decisionElapsedMs += Math.max(0, now - state.decisionStartedAt);
        state.decisionStartedAt = null;
      } else if (status === "active") state.decisionStartedAt = now;
    }
    const next = sessionSchema.parse({ ...session, state, status, endedAt: status === "closed" ? now : null, updatedAt: now });
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
