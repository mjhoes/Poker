import { useCallback, useEffect, useMemo, useState } from "react";
import type { Machine, Paytable, Wallet } from "@perfect-draw/shared";
import { useAppStore } from "./state/app-store";
import { machineService } from "./services/machines";
import { sessionService } from "./services/sessions";
import { walletService } from "./services/wallets";
import { money } from "./components/UiHelpers";
import { draftFrom, starterDraft } from "./machines/machine-info";
import { ToastViewport, toast } from "./components/Toasts";
import { useConfirm } from "./components/ConfirmDialog";
import { feltFor } from "./components/Felt";
import { AppHeader } from "./components/AppHeader";
import { useActionRunner } from "./hooks/useActionRunner";
import { useRoute } from "./hooks/useRoute";
import { useSessionActions } from "./hooks/useSessionActions";
import { useBackup } from "./hooks/useBackup";
import { useTableAnalysis } from "./hooks/useTableAnalysis";
import { useWalletLedger } from "./hooks/useWalletLedger";
import { MachineDialog } from "./dialogs/MachineDialog";
import { StartSessionDialog } from "./dialogs/StartSessionDialog";
import { NewWalletDialog, RenameWalletDialog, WalletAmountDialog } from "./dialogs/WalletDialogs";
import { PayTableDialog, RenamePaytableDialog } from "./dialogs/PayTableDialogs";
import { paytableService } from "./services/paytables";
import { preferencesService } from "./services/preferences";
import { findPaytable } from "./paytables/catalog";
import { currentBet } from "./table/BetControls";
import { HomePage } from "./pages/HomePage";
import { WalletsPage } from "./pages/WalletsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SessionPage } from "./pages/SessionPage";
import { StatsPage } from "./pages/StatsPage";

type Dialog =
  | { kind: "machine"; machine?: Machine }
  | { kind: "start"; machine: Machine; mode: "free_play" | "drill"; reason?: string }
  | { kind: "wallet" }
  | { kind: "rename"; wallet: Wallet }
  | { kind: "topup" | "transfer"; wallet: Wallet }
  | { kind: "paytable"; startFromId?: string }
  | { kind: "rename-paytable"; table: Paytable };

function App() {
  const { ready, error: storeError, retentionError, machines, wallets, paytables, deckColors, sessions, activeSessionId, storageStatus, decisionCount, backupDue, lastBackupAt } = useAppStore();
  const { route, navigate } = useRoute();
  const runner = useActionRunner();
  const { busy, run } = runner;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selectedWallet, setSelectedWallet] = useState("");
  const [sessionViewId, setSessionViewId] = useState<string | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);

  const openSessions = useMemo(() => Object.values(sessions).filter(session => session.status !== "closed").sort((a, b) => a.startedAt - b.startedAt), [sessions]);
  const historySessions = useMemo(() => Object.values(sessions).filter(session => session.status === "closed").sort((a, b) => b.startedAt - a.startedAt), [sessions]);
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const shownSession = route === "/session" ? (sessionViewId ? sessions[sessionViewId] : undefined) ?? activeSession ?? openSessions[0] : activeSession;
  const openRoom = useCallback(() => navigate("/session"), [navigate]);

  const play = useSessionActions({ runner, confirm, shownSessionId: shownSession?.id, onShowSession: setSessionViewId, onOpenRoom: openRoom });
  const backup = useBackup({ run, confirm });
  const tableAnalysis = useTableAnalysis(shownSession, route === "/session", shownSession ? currentBet(shownSession).coins : undefined);
  const ledger = useWalletLedger(selectedWallet, [wallets, decisionCount]);

  // Ctrl+1–9 switches between open sessions from anywhere in the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const session = openSessions[Number(event.key) - 1];
      if (!session) return;
      event.preventDefault();
      void play.activate(session.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSessions, play]);

  function newMachine() {
    if (!wallets.length) { toast.info("Set up a wallet first. Each machine plays from a default wallet."); navigate("/wallets"); return; }
    setDialog({ kind: "machine" });
  }
  async function deleteMachine(value: Machine) {
    if (!await confirm({
      title: `Delete “${value.name}”?`, tone: "danger", icon: "trash", confirmLabel: "Delete machine",
      body: <p>Reports from its closed sessions stay in your history. If a session on this machine is still open, close it first.</p>,
    })) return;
    await run(() => machineService.remove(value.id), { success: "Machine deleted." });
  }
  /**
   * One click to play: continue this machine's open session in that mode, or start one with its default wallet.
   * The wallet dialog appears only when there is a real choice to make.
   */
  async function playMachine(value: Machine, mode: "free_play" | "drill") {
    const open = Object.values(sessions).find(session => session.machineId === value.id && session.mode === mode && session.status !== "closed");
    if (open) { await play.activate(open.id); return; }
    const wallet = wallets.find(item => item.id === value.defaultWalletId);
    const bet = value.coins * value.lines * value.denominationCents;
    if (!wallet) { setDialog({ kind: "start", machine: value, mode, reason: "This machine's default wallet was deleted. Choose another wallet." }); return; }
    if (mode === "free_play" && wallet.balanceCents < bet) {
      setDialog({ kind: "start", machine: value, mode, reason: `${wallet.name} has ${money(wallet.balanceCents)}, less than one ${money(bet)} bet. Choose another wallet, or add credits on the Wallets page.` });
      return;
    }
    await run(async () => {
      await sessionService.start({ machineId: value.id, walletId: wallet.id, mode });
      setSessionViewId(null); openRoom();
    });
  }
  async function duplicateMachine(value: Machine) {
    await run(() => machineService.save(draftFrom(value, { name: `${value.name} (copy)`.slice(0, 100) })), { success: "Machine duplicated." });
  }
  async function deletePaytable(table: Paytable) {
    if (!await confirm({
      title: `Delete “${table.name}”?`, tone: "danger", icon: "trash", confirmLabel: "Delete pay table",
      body: <p>Past sessions and statistics that used it keep their records. Machines and open sessions must stop using it first.</p>,
    })) return;
    await run(() => paytableService.remove(table.id), { success: "Pay table deleted." });
  }
  async function createBankroll(cents: number) {
    await run(() => walletService.create({ name: "Bankroll", initialCents: cents }), { success: `Bankroll ready: ${money(cents)}.` });
  }
  async function addStarter(slug: string) {
    const draft = wallets[0] ? starterDraft(slug, wallets[0].id) : null;
    if (draft) await run(() => machineService.save(draft), { success: "Machine added. Press Play when you're ready." });
  }

  if (!ready) return <div className="app-shell"><div className="topline" /><div className="main-content loading-screen">{storeError ? <div className="error-banner" role="alert">Local storage could not be opened. {storeError}<br />Refresh to retry after checking browser storage permissions.</div> : <><div className="skeleton" /><p className="eyebrow" style={{ marginTop: 18 }}>Opening your private training room…</p></>}</div></div>;
  const roomFelt = route === "/session" && shownSession ? feltFor(shownSession, machines) : undefined;
  const dialogProps = { busy, run, onClose: closeDialog };

  return <div className="app-shell" data-room-felt={roomFelt} data-deck={deckColors}>
    <div className="topline" />
    <AppHeader route={route} openSessions={openSessions} activeSessionId={activeSessionId} onSelectSession={id => void play.activate(id)}
      bankrollCents={wallets.length ? wallets.reduce((sum, wallet) => sum + wallet.balanceCents, 0) : null} />
    <main className="main-content">
      {retentionError && <div className="error-banner" role="alert">{retentionError}</div>}
      {backupDue && route !== "/settings" && <div className="backup-nudge" role="status"><span className="backup-nudge-dot" aria-hidden="true" /><span>Backup due: 500 or more decisions since your last backup.</span><button className="btn secondary small" type="button" disabled={busy} onClick={backup.exportBackup}>Export backup</button></div>}
      {storeError && <div className="error-banner" role="alert">{storeError}</div>}
      {route === "/" && <HomePage machines={machines} wallets={wallets} sessions={sessions} busy={busy}
        onCreate={newMachine} onEdit={value => setDialog({ kind: "machine", machine: value })} onDuplicate={value => void duplicateMachine(value)}
        onDelete={value => void deleteMachine(value)} onPlay={(value, mode) => void playMachine(value, mode)}
        onPlayWithWallet={value => setDialog({ kind: "start", machine: value, mode: "free_play" })}
        onCreateBankroll={cents => void createBankroll(cents)} onAddStarter={slug => void addStarter(slug)} />}
      {route === "/wallets" && <WalletsPage wallets={wallets} selectedWallet={selectedWallet} ledger={ledger} onSelect={setSelectedWallet} busy={busy}
        onCreate={() => setDialog({ kind: "wallet" })} onRename={wallet => setDialog({ kind: "rename", wallet })}
        onTopup={wallet => setDialog({ kind: "topup", wallet })} onTransfer={wallet => setDialog({ kind: "transfer", wallet })} />}
      {route === "/settings" && <SettingsPage storageStatus={storageStatus} decisionCount={decisionCount} backupDue={backupDue} lastBackupAt={lastBackupAt} busy={busy || backup.importing} onExport={backup.exportBackup} onImport={backup.importBackup}
        paytables={paytables} machines={machines} onNewPaytable={() => setDialog({ kind: "paytable" })} onCopyPaytable={table => setDialog({ kind: "paytable", startFromId: table.id })}
        onRenamePaytable={table => setDialog({ kind: "rename-paytable", table })} onDeletePaytable={table => void deletePaytable(table)}
        deckColors={deckColors} onDeckColors={value => void run(() => preferencesService.setDeckColors(value))} />}
      {route === "/stats" && <StatsPage machines={machines} decisionCount={decisionCount} onTrainStarted={() => { setSessionViewId(null); openRoom(); }} onGoMachines={() => navigate("/")} />}
      {route === "/session" && <SessionPage session={shownSession} felt={roomFelt ?? "felt"} sessions={historySessions}
        analysis={tableAnalysis.analysis} analysisError={tableAnalysis.error} analysisLoading={tableAnalysis.loading} onRetry={tableAnalysis.request}
        busy={busy} playError={play.playError} onRetryPlay={play.retryPlay}
        onPause={play.pause} onResume={play.resume} onClose={play.close}
        onSelect={id => { if (sessions[id]?.status === "closed") setSessionViewId(id); else void play.activate(id); }}
        onHold={play.toggleHeld} onSetMask={play.setHeldMask} onDeal={play.deal} onSubmit={play.submit} onFeedback={play.setFeedback}
        onBet={play.setBet} onBetMax={play.betMax} />}
      <div className="footer-note">PRACTICE CREDITS ONLY · NO REAL MONEY · YOUR DATA STAYS ON THIS DEVICE</div>
    </main>
    <ToastViewport />
    {confirmDialog}

    {dialog?.kind === "machine" && <MachineDialog machine={dialog.machine} wallets={wallets} {...dialogProps} />}
    {dialog?.kind === "start" && <StartSessionDialog machine={dialog.machine} wallets={wallets} initialMode={dialog.mode} reason={dialog.reason} {...dialogProps} onStarted={() => { setSessionViewId(null); closeDialog(); openRoom(); }} />}
    {dialog?.kind === "wallet" && <NewWalletDialog {...dialogProps} onCreated={setSelectedWallet} />}
    {dialog?.kind === "rename" && <RenameWalletDialog wallet={dialog.wallet} {...dialogProps} />}
    {dialog?.kind === "paytable" && <PayTableDialog startFrom={dialog.startFromId ? findPaytable(dialog.startFromId, paytables) : undefined} {...dialogProps} />}
    {dialog?.kind === "rename-paytable" && <RenamePaytableDialog table={dialog.table} {...dialogProps} />}
    {(dialog?.kind === "topup" || dialog?.kind === "transfer") && <WalletAmountDialog kind={dialog.kind} wallet={dialog.wallet} wallets={wallets} {...dialogProps} />}
  </div>;
}

export default App;
