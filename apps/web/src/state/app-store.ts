import { liveQuery } from "dexie";
import { create } from "zustand";
import { profileSchema } from "@perfect-draw/shared";
import type { Machine, Paytable, Session, Wallet } from "@perfect-draw/shared";
import { db, initializeDatabase } from "../data/db";
import { machineService } from "../services/machines";
import { walletService } from "../services/wallets";
import { sessionService } from "../services/sessions";
import { paytableService } from "../services/paytables";
import { requestPersistentStorage } from "../services/storage";
import type { StorageStatus } from "../services/storage";
import { countDecisions, RAW_DECISION_RETENTION_DAYS } from "../services/retention";
import { engineClient } from "../worker/client";

export interface AppState {
  ready: boolean; error: string | null; machines: Machine[]; wallets: Wallet[];
  /** Custom (hand-entered) pay tables; the built-in library is static and not stored here. */
  paytables: Paytable[];
  retentionError: string | null;
  sessions: Record<string, Session>; activeSessionId: string | null;
  storageStatus: StorageStatus; decisionCount: number; backupDue: boolean; lastBackupAt: number | null;
  deckColors: "two" | "four";
}
export const useAppStore = create<AppState>(() => ({
  ready: false, error: null, machines: [], wallets: [], paytables: [], sessions: {}, activeSessionId: null,
  retentionError: null,
  storageStatus: "checking", decisionCount: 0, backupDue: false, lastBackupAt: null, deckColors: "two",
}));
let started = false;
export async function startAppStore() {
  if (started) return;
  started = true;
  try {
    await initializeDatabase();
    // Wallet management never depends on Worker availability or lengthy analysis.
    void db.records("decisions").where("createdAt").below(Date.now() - RAW_DECISION_RETENTION_DAYS * 86_400_000).count()
      .then(count => count ? engineClient().rollupDecisions(Intl.DateTimeFormat().resolvedOptions().timeZone) : 0)
      .catch(error => useAppStore.setState({ retentionError: `History cleanup could not finish; raw decisions are safe. ${String(error)}` }));
    void requestPersistentStorage().then(storageStatus => useAppStore.setState({ storageStatus }));
    liveQuery(async () => {
      const [machines, wallets, paytables, sessionRows, profile, decisionCount] = await Promise.all([
        machineService.list(), walletService.list(), paytableService.listCustom(), sessionService.list(),
        db.records("profile").get("local").then(x => profileSchema.parse(x)), countDecisions(),
      ]);
      const sessions = Object.fromEntries(sessionRows.map(x => [x.id, x]));
      const active = profile.prefs.activeSessionId;
      return {
        machines, wallets, paytables, sessions, activeSessionId: active && sessions[active] && sessions[active].status !== "closed" ? active : null,
        decisionCount, backupDue: decisionCount - profile.prefs.lastBackupDecisionCount >= 500,
        lastBackupAt: profile.prefs.lastBackupAt, deckColors: profile.prefs.deckColors, ready: true, error: null,
      };
    }).subscribe({
      next: state => useAppStore.setState(state),
      error: error => useAppStore.setState({ error: String(error), ready: false }),
    });
  } catch (error) { useAppStore.setState({ error: `Local storage could not be opened: ${String(error)}` }); }
}
void startAppStore();
