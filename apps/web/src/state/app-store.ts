import { liveQuery } from "dexie";
import { create } from "zustand";
import { profileSchema } from "@perfect-draw/shared";
import type { Machine, Session, Wallet } from "@perfect-draw/shared";
import { db, initializeDatabase } from "../data/db";
import { machineService } from "../services/machines";
import { walletService } from "../services/wallets";
import { sessionService } from "../services/sessions";
import { requestPersistentStorage } from "../services/storage";
import type { StorageStatus } from "../services/storage";

export interface AppState {
  ready: boolean; error: string | null; machines: Machine[]; wallets: Wallet[];
  sessions: Record<string, Session>; activeSessionId: string | null;
  storageStatus: StorageStatus; decisionCount: number; backupDue: boolean; lastBackupAt: number | null;
}
export const useAppStore = create<AppState>(() => ({
  ready: false, error: null, machines: [], wallets: [], sessions: {}, activeSessionId: null,
  storageStatus: "checking", decisionCount: 0, backupDue: false, lastBackupAt: null,
}));
let started = false;
export async function startAppStore() {
  if (started) return;
  started = true;
  try {
    await initializeDatabase();
    void requestPersistentStorage().then(storageStatus => useAppStore.setState({ storageStatus }));
    liveQuery(async () => {
      const [machines, wallets, sessionRows, profile, decisionCount] = await Promise.all([
        machineService.list(), walletService.list(), sessionService.list(),
        db.records("profile").get("local").then(x => profileSchema.parse(x)), db.records("decisions").count(),
      ]);
      const sessions = Object.fromEntries(sessionRows.map(x => [x.id, x]));
      const active = profile.prefs.activeSessionId;
      return {
        machines, wallets, sessions, activeSessionId: active && sessions[active] && sessions[active].status !== "closed" ? active : null,
        decisionCount, backupDue: decisionCount - profile.prefs.lastBackupDecisionCount >= 500,
        lastBackupAt: profile.prefs.lastBackupAt, ready: true, error: null,
      };
    }).subscribe({
      next: state => useAppStore.setState(state),
      error: error => useAppStore.setState({ error: String(error), ready: false }),
    });
  } catch (error) { useAppStore.setState({ error: `Local storage could not be opened: ${String(error)}` }); }
}
void startAppStore();
