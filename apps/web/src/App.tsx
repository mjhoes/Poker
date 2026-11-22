import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { Machine, Session, WalletLedger } from "@perfect-draw/shared";
import { machineDraftSchema } from "@perfect-draw/shared";
import { Field, Modal, creditLabel, modeName, money, plural } from "./components/UiHelpers";
import { ToastViewport, clearToasts, toast } from "./components/Toasts";
import { useConfirm } from "./components/ConfirmDialog";
import { FeltPicker, feltFor } from "./components/Felt";
import { useAppStore } from "./state/app-store";
import { machineService } from "./services/machines";
import { walletService } from "./services/wallets";
import { sessionService } from "./services/sessions";
import { playService } from "./services/play";
import { backupService } from "./services/backup";
import { engineClient } from "./worker/client";
import type { AnalysisSummary } from "./worker/engine-api";
import { HomePage } from "./pages/HomePage";
import { WalletsPage } from "./pages/WalletsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SessionPage } from "./pages/SessionPage";
import { StatsPage } from "./pages/StatsPage";
import { parseCents } from "./services/money";

type Route = "/" | "/wallets" | "/settings" | "/session" | "/stats";
type ModalKind = "machine" | "start" | "wallet" | "rename" | "topup" | "transfer" | null;
type MachineForm = {
  name: string; paytableId: string; denomination: string; coins: string; lines: string;
  theme: "felt" | "midnight" | "classic"; speed: "relaxed" | "normal" | "fast";
  defaultWalletId: string; casinoName: string; location: string; notes: string;
};

const blankMachine = (walletId = "", tableId = PAY_TABLE_LIBRARY[0]?.id ?? ""): MachineForm => ({
  name: "", paytableId: tableId, denomination: "0.25", coins: "5", lines: "1",
  theme: "felt", speed: "normal", defaultWalletId: walletId, casinoName: "", location: "", notes: "",
});
function App() {
  const { ready, error: storeError, retentionError, machines, wallets, sessions, activeSessionId, storageStatus, decisionCount, backupDue, lastBackupAt } = useAppStore();
  const [route, setRoute] = useState<Route>(window.location.hash.slice(1) as Route || "/");
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedMachine, setSelectedMachine] = useState(0);
  const [sessionViewId, setSessionViewId] = useState<string | null>(null);
  const [machineForm, setMachineForm] = useState<MachineForm>(blankMachine());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [machineWallet, setMachineWallet] = useState("");
  const [startMode, setStartMode] = useState<"free_play" | "drill">("free_play");
  const [walletName, setWalletName] = useState("");
  const [initialAmount, setInitialAmount] = useState("");
  const [walletTarget, setWalletTarget] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [selectedWallet, setSelectedWallet] = useState("");
  const [ledger, setLedger] = useState<WalletLedger[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const [analysisRequested, setAnalysisRequested] = useState(false);
  const [playError, setPlayError] = useState("");
  const playRetryRef = useRef<(() => Promise<unknown>) | null>(null);
  const busyRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const modalRef = useRef<ModalKind>(null);
  modalRef.current = modal;

  const openSessions = useMemo(() => Object.values(sessions).filter(session => session.status !== "closed").sort((a, b) => a.startedAt - b.startedAt), [sessions]);
  const historySessions = useMemo(() => Object.values(sessions).filter(session => session.status === "closed").sort((a, b) => b.startedAt - a.startedAt), [sessions]);
  const machine = machines[Math.min(selectedMachine, Math.max(0, machines.length - 1))];
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const shownSession = route === "/session" ? (sessionViewId ? sessions[sessionViewId] : undefined) ?? activeSession ?? openSessions[0] : activeSession;

  const navigate = useCallback((next: Route) => { window.location.hash = next; }, []);
  useEffect(() => {
    const syncRoute = () => {
      const next = (window.location.hash.slice(1) || "/") as Route;
      setRoute(["/", "/wallets", "/settings", "/session", "/stats"].includes(next) ? next : "/");
      clearToasts("error");
    };
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const number = Number(event.key);
      if (number < 1 || number > 9) return;
      const session = openSessions[number - 1];
      if (session) {
        event.preventDefault();
        void activateSession(session.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // Session activation is deliberately routed through the same action function.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessions]);
  useEffect(() => {
    setAnalysis(null); setAnalysisError(""); setAnalysisLoading(false); setAnalysisRequested(false);
  }, [route, shownSession?.id, shownSession?.machineSnapshot.paytableId]);
  useEffect(() => {
    setPlayError("");
    playRetryRef.current = null;
  }, [shownSession?.id]);
  useEffect(() => {
    if (route !== "/session" || !shownSession || shownSession.status === "closed" || !analysisRequested) return;
    let cancelled = false;
    setAnalysisError(""); setAnalysisLoading(true);
    Promise.resolve().then(() => engineClient().loadAnalysis(shownSession.machineSnapshot.paytableId))
      .then(result => { if (!cancelled) setAnalysis(result); })
      .catch(reason => { if (!cancelled) setAnalysisError(String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (!cancelled) setAnalysisLoading(false); });
    return () => { cancelled = true; };
  }, [route, shownSession?.id, shownSession?.machineSnapshot.paytableId, analysisRequested, analysisRetry]);
  useEffect(() => {
    if (!selectedWallet) { setLedger([]); return; }
    let cancelled = false;
    walletService.ledger(selectedWallet).then(rows => { if (!cancelled) setLedger(rows); }).catch(reason => { if (!cancelled) toast.error(String(reason)); });
    return () => { cancelled = true; };
  }, [selectedWallet, wallets, decisionCount]);

  async function run(action: () => Promise<unknown>, success?: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await action(); if (success) toast.success(success); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      // Errors from a dialog stay in that dialog; everything else becomes a toast that waits to be dismissed.
      if (modalRef.current) setError(message); else toast.error(message);
    }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function runPlay(action: () => Promise<unknown>, remember = true) {
    if (busyRef.current) return;
    if (remember) playRetryRef.current = action;
    busyRef.current = true; setBusy(true); setPlayError("");
    try { await action(); }
    catch (reason) { setPlayError(reason instanceof Error ? reason.message : String(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function activateSession(id: string) {
    setSessionViewId(null);
    await run(async () => { await sessionService.activate(id); navigate("/session"); });
  }
  function startNewMachine() {
    if (!wallets.length) { toast.info("Set up a wallet first. Each machine plays from a default wallet."); navigate("/wallets"); return; }
    setEditingId(null); setMachineForm(blankMachine(wallets[0].id)); setError(""); setModal("machine");
  }
  function editMachine(value: Machine) {
    setEditingId(value.id);
    setMachineForm({
      name: value.name, paytableId: value.paytableId, denomination: (value.denominationCents / 100).toFixed(2),
      coins: String(value.coins), lines: String(value.lines), theme: value.theme, speed: value.speed,
      defaultWalletId: value.defaultWalletId, casinoName: value.casinoName, location: value.location, notes: value.notes,
    });
    setError(""); setModal("machine");
  }
  function beginStart(value: Machine) {
    setMachineWallet(value.defaultWalletId); setStartMode("free_play"); setError(""); setModal("start");
  }
  async function saveMachine(event: FormEvent) {
    event.preventDefault();
    const denominationCents = parseCents(machineForm.denomination);
    if (!denominationCents || denominationCents > 100000) { setError("Enter a denomination between $0.01 and $1,000.00, with at most two decimal places."); return; }
    if (!machineForm.name.trim() || !machineForm.defaultWalletId || !machineForm.paytableId) { setError("Name, paytable, and default wallet are required."); return; }
    const parsedDraft = machineDraftSchema.safeParse({
      name: machineForm.name.trim(), paytableId: machineForm.paytableId,
      variant: { kind: "standard", config: {} }, denominationCents,
      coins: Number(machineForm.coins), lines: Number(machineForm.lines),
      theme: machineForm.theme, speed: machineForm.speed, defaultWalletId: machineForm.defaultWalletId,
      casinoName: machineForm.casinoName, location: machineForm.location, notes: machineForm.notes,
    });
    if (!parsedDraft.success) { setError(parsedDraft.error.issues[0]?.message ?? "Check the machine configuration."); return; }
    await run(async () => {
      await machineService.save(parsedDraft.data, editingId ?? undefined);
      setModal(null);
    }, editingId ? "Machine updated." : "Machine added.");
  }
  async function deleteMachine(value: Machine) {
    if (!await confirm({
      title: `Delete “${value.name}”?`, tone: "danger", icon: "trash", confirmLabel: "Delete machine",
      body: <p>Reports from its closed sessions stay in your history. If a session on this machine is still open, close it first.</p>,
    })) return;
    await run(() => machineService.remove(value.id), "Machine deleted.");
    setSelectedMachine(0);
  }
  async function startSession(event: FormEvent) {
    event.preventDefault();
    if (!machine || !machineWallet) { setError("Choose a wallet."); return; }
    await run(async () => {
      await sessionService.start({ machineId: machine.id, walletId: machineWallet, mode: startMode });
      setSessionViewId(null); setModal(null); navigate("/session");
    });
  }
  async function createWallet(event: FormEvent) {
    event.preventDefault();
    const centsValue = initialAmount.trim() === "" ? 0 : parseCents(initialAmount, true);
    if (centsValue === null) { setError("Enter a non-negative amount with no more than two decimal places."); return; }
    await run(async () => {
      const wallet = await walletService.create({ name: walletName.trim(), initialCents: centsValue });
      setSelectedWallet(wallet.id); setWalletName(""); setInitialAmount(""); setModal(null);
    }, "Wallet created.");
  }
  async function renameWallet(event: FormEvent) {
    event.preventDefault();
    await run(async () => { await walletService.rename(walletTarget, walletName.trim()); setWalletName(""); setModal(null); }, "Wallet renamed.");
  }
  async function topupWallet(event: FormEvent) {
    event.preventDefault();
    const centsValue = parseCents(amountInput);
    if (!centsValue) { setError("Enter an amount greater than $0.00 with no more than two decimal places."); return; }
    await run(async () => {
      if (modal === "topup") await walletService.topup({ walletId: walletTarget, amountCents: centsValue });
      else await walletService.transfer({ fromId: walletTarget, toId: transferTarget, amountCents: centsValue });
      setAmountInput(""); setModal(null);
    }, modal === "topup" ? "Credits added." : "Transfer complete.");
  }
  async function changeStatus(action: "pause" | "resume" | "close", session: Session) {
    if (action === "close") {
      const { hands, netCents, errors } = session.summary;
      const ok = await confirm({
        title: "Close this session?", icon: "door", confirmLabel: "Close session",
        body: <>
          <dl className="confirm-summary">
            <div><dt>Hands</dt><dd>{hands.toLocaleString()}</dd></div>
            {session.mode === "free_play" && <div><dt>Net</dt><dd className={netCents < 0 ? "negative" : "positive"}>{money(netCents)}</dd></div>}
            <div><dt>Mistakes</dt><dd>{errors.toLocaleString()}</dd></div>
          </dl>
          <p>You'll get the full session report, and it stays in your history.</p>
        </>,
      });
      if (!ok) return;
    }
    const fn = action === "pause" ? sessionService.pause : action === "resume" ? sessionService.resume : sessionService.close;
    await run(async () => {
      await fn(session.id);
      if (action === "close") setSessionViewId(session.id);
    });
  }
  async function toggleHeld(session: Session, index: number) {
    const nextMask = session.state.heldMask ^ (1 << index);
    await runPlay(() => sessionService.applyAction(session.id, { type: "hold", heldMask: nextMask, handId: session.state.handId }));
  }
  async function setHeldMask(session: Session, heldMask: number) {
    await runPlay(() => sessionService.applyAction(session.id, { type: "hold", heldMask, handId: session.state.handId }));
  }
  async function dealHand(session: Session) {
    await runPlay(() => playService.deal(session.id, session.state.handId));
  }
  async function submitHand(session: Session, confirmMistake = false) {
    if (!session.state.handId) return;
    await runPlay(() => playService.submit(session.id, session.state.handId!, confirmMistake));
  }
  async function setFeedback(session: Session, feedbackMode: Session["state"]["feedbackMode"]) {
    await runPlay(() => sessionService.applyAction(session.id, { type: "feedback", feedbackMode }));
  }
  async function exportBackup() {
    await run(async () => {
      const text = await backupService.export();
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `perfect-draw-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "Backup downloaded. Keep a copy somewhere other than this device.");
  }
  async function importBackup(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 100_000_000) { toast.error("That backup is over the 100 MB limit. Nothing was changed."); return; }
    if (!await confirm({
      title: "Restore from this backup?", tone: "danger", icon: "restore", confirmLabel: "Replace my data",
      body: <p>Everything on this device (wallets, machines, sessions and history) will be replaced with the contents of <strong>{file.name}</strong>. Saved API keys are erased. This can't be undone.</p>,
      acknowledge: "I understand this replaces all data on this device.",
    })) return;
    setImporting(true); clearToasts();
    try {
      const text = await file.text();
      const result = await backupService.import(text);
      setAnalysis(null); setAnalysisError("");
      toast.success(`Backup restored: ${result.records} records replaced. Reloading…`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)); }
    finally { setImporting(false); }
  }

  if (!ready) return <div className="app-shell"><div className="topline" /><div className="main-content loading-screen">{storeError ? <div className="error-banner" role="alert">Local storage could not be opened. {storeError}<br />Refresh to retry after checking browser storage permissions.</div> : <><div className="skeleton" /><p className="eyebrow" style={{ marginTop: 18 }}>Opening your private training room…</p></>}</div></div>;
  const roomFelt = route === "/session" && shownSession ? feltFor(shownSession, machines) : undefined;
  return <div className="app-shell" data-room-felt={roomFelt}>
    <div className="topline" />
    <header className="app-header">
      <div className="header-inner">
        <a className="brand" href="#/" aria-label="Perfect Draw home"><span className="brand-mark" aria-hidden="true">P</span><span className="brand-name">PERFECT DRAW</span></a>
        <nav className="nav-links" aria-label="Main navigation">
          <a className={`nav-link ${route === "/" ? "active" : ""}`} href="#/">Machines</a>
          <a className={`nav-link ${route === "/wallets" ? "active" : ""}`} href="#/wallets">Wallets</a>
          <a className={`nav-link ${route === "/session" ? "active" : ""}`} href="#/session">Session room</a>
          <a className={`nav-link ${route === "/stats" ? "active" : ""}`} href="#/stats">Statistics</a>
          <a className={`nav-link ${route === "/settings" ? "active" : ""}`} href="#/settings">Settings</a>
        </nav>
      </div>
      {openSessions.length > 0 && <div className="session-rail" aria-label="Open sessions">
        <span className="rail-label">OPEN SESSIONS</span>
        {openSessions.map((session, index) => {
          const config = session.machineSnapshot;
          const creditsCount = creditLabel(session.state);
          const amount = money(Math.round(session.state.credits * config.denominationCents) + session.state.creditRemainderCents);
          return <button key={session.id} type="button" className={`session-chip ${session.id === activeSessionId ? "selected" : ""}`} aria-label={`Select session ${index + 1}: ${config.name}, ${creditsCount} (${amount}), ${modeName(session.mode)}, ${session.status}${session.id === activeSessionId ? ", active" : ""}`} onClick={() => void activateSession(session.id)}>
            <span className={`chip-state ${session.status === "paused" ? "paused" : ""}`} />
            <span className="chip-name">{config.name}</span>
            <span className="chip-meta">{creditsCount} · {amount} · {modeName(session.mode)}</span>
            {session.status === "paused" && <span className="chip-meta">PAUSED</span>}
          </button>;
        })}
        <span className="chip-meta rail-hint" aria-hidden="true">CTRL + 1–9</span>
      </div>}
    </header>
    <main className="main-content">
      {retentionError && <div className="error-banner" role="alert">{retentionError}</div>}
      {backupDue && route !== "/settings" && <div className="backup-nudge" role="status"><span className="backup-nudge-dot" aria-hidden="true" /><span>Backup due: 500 or more decisions since your last backup.</span><button className="btn secondary small" type="button" disabled={busy} onClick={() => void exportBackup()}>Export backup</button></div>}
      {storeError && <div className="error-banner" role="alert">{storeError}</div>}
      {route === "/" && <HomePage machines={machines} wallets={wallets} sessions={sessions} machine={machine} selectedMachine={selectedMachine} busy={busy} onSelect={setSelectedMachine} onCreate={startNewMachine} onEdit={editMachine} onDelete={deleteMachine} onStart={beginStart} onWallets={() => navigate("/wallets")} />}
      {route === "/wallets" && <WalletsPage wallets={wallets} selectedWallet={selectedWallet} ledger={ledger} onSelect={setSelectedWallet} onCreate={() => { setError(""); setWalletName(""); setInitialAmount(""); setModal("wallet"); }} onRename={wallet => { setWalletTarget(wallet.id); setWalletName(wallet.name); setModal("rename"); }} onTopup={wallet => { setWalletTarget(wallet.id); setAmountInput(""); setModal("topup"); }} onTransfer={wallet => { setWalletTarget(wallet.id); setTransferTarget(wallets.find(item => item.id !== wallet.id)?.id ?? ""); setAmountInput(""); setModal("transfer"); }} busy={busy} />}
      {route === "/settings" && <SettingsPage storageStatus={storageStatus} decisionCount={decisionCount} backupDue={backupDue} lastBackupAt={lastBackupAt} busy={busy || importing} onExport={() => void exportBackup()} onImport={event => void importBackup(event)} />}
      {route === "/stats" && <StatsPage machines={machines} decisionCount={decisionCount} onTrainStarted={() => { setSessionViewId(null); navigate("/session"); }} onGoMachines={() => navigate("/")} />}
      {route === "/session" && <SessionPage session={shownSession} felt={roomFelt ?? "felt"} sessions={historySessions} analysis={analysis} analysisError={analysisError} analysisLoading={analysisLoading} busy={busy} playError={playError} onRetryPlay={() => { const retry = playRetryRef.current; if (retry) void runPlay(retry, false); }} onPause={session => void changeStatus("pause", session)} onResume={session => void changeStatus("resume", session)} onClose={session => void changeStatus("close", session)} onSelect={id => {
        const selected = sessions[id];
        if (selected?.status === "closed") setSessionViewId(id);
        else void activateSession(id);
      }} onHold={toggleHeld} onSetMask={setHeldMask} onDeal={dealHand} onSubmit={submitHand} onFeedback={setFeedback} onRetry={() => { setAnalysisRequested(true); setAnalysisRetry(value => value + 1); }} />}
      <div className="footer-note">PRACTICE CREDITS ONLY · NO REAL MONEY · YOUR DATA STAYS ON THIS DEVICE</div>
    </main>
    <ToastViewport />
    {confirmDialog}

    {modal && <Modal error={error} title={modal === "machine" ? editingId ? "Edit machine" : "New machine" : modal === "start" ? "Prepare a session" : modal === "wallet" ? "New wallet" : modal === "rename" ? "Rename wallet" : modal === "topup" ? "Add credits" : "Transfer credits"} subtitle={modal === "machine" ? "Pick the game, pay table and bet you want to practice." : modal === "start" ? "Choose how you want to play this machine." : undefined} onClose={() => setModal(null)}>
      {modal === "machine" && <form onSubmit={event => void saveMachine(event)}>
        <div className="form-grid">
          <Field label="Machine name"><input aria-label="Machine name" required maxLength={100} value={machineForm.name} onChange={event => setMachineForm({ ...machineForm, name: event.target.value })} placeholder="e.g. Main practice table" /></Field>
          <Field label="Pay table"><select aria-label="Paytable library" required value={machineForm.paytableId} onChange={event => setMachineForm({ ...machineForm, paytableId: event.target.value })}>{PAY_TABLE_LIBRARY.map(table => <option key={table.id} value={table.id}>{table.name}</option>)}</select></Field>
          <Field label="Denomination (USD)"><input aria-label="Denomination in dollars" inputMode="decimal" required value={machineForm.denomination} onChange={event => setMachineForm({ ...machineForm, denomination: event.target.value })} /></Field>
          <Field label="Coins per hand"><select aria-label="Coins per hand" value={machineForm.coins} onChange={event => setMachineForm({ ...machineForm, coins: event.target.value })}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} coin{value === 1 ? "" : "s"}</option>)}</select></Field>
          <Field label="Lines"><select aria-label="Lines" value={machineForm.lines} onChange={event => setMachineForm({ ...machineForm, lines: event.target.value })}>{[1, 3, 5, 10].map(value => <option key={value} value={value}>{value} line{value === 1 ? "" : "s"}</option>)}</select></Field>
          <div className="field full"><span className="field-label">Table felt</span><FeltPicker value={machineForm.theme} onChange={theme => setMachineForm({ ...machineForm, theme })} /></div>
          <Field label="Table speed"><select aria-label="Table speed" value={machineForm.speed} onChange={event => setMachineForm({ ...machineForm, speed: event.target.value as MachineForm["speed"] })}><option value="relaxed">Relaxed</option><option value="normal">Normal</option><option value="fast">Fast</option></select></Field>
          <Field label="Default wallet"><select aria-label="Default wallet" required value={machineForm.defaultWalletId} onChange={event => setMachineForm({ ...machineForm, defaultWalletId: event.target.value })}>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {money(wallet.balanceCents)}</option>)}</select></Field>
          <Field label="Casino or venue (optional)"><input aria-label="Casino or venue" maxLength={120} value={machineForm.casinoName} onChange={event => setMachineForm({ ...machineForm, casinoName: event.target.value })} /></Field>
          <Field label="Location (optional)"><input aria-label="Location" maxLength={200} value={machineForm.location} onChange={event => setMachineForm({ ...machineForm, location: event.target.value })} /></Field>
          <Field label="Notes (optional)" full><textarea aria-label="Private notes" maxLength={2000} value={machineForm.notes} onChange={event => setMachineForm({ ...machineForm, notes: event.target.value })} /></Field>
        </div>
        <div className="form-actions"><button className="btn secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Save configuration"}</button></div>
      </form>}
      {modal === "start" && machine && <form onSubmit={event => void startSession(event)}>
        <div className="terms-box"><strong>{machine.name}</strong> · {PAY_TABLE_LIBRARY.find(table => table.id === machine.paytableId)?.name ?? "Custom pay table"} · {money(machine.denominationCents)} · {plural(machine.coins, "coin")} × {plural(machine.lines, "line")}</div>
        <div className="form-grid">
          <Field label="Wallet"><select aria-label="Practice wallet" required value={machineWallet} onChange={event => setMachineWallet(event.target.value)}>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {money(wallet.balanceCents)}</option>)}</select></Field>
           <Field label="Session mode"><select aria-label="Session mode" value={startMode} onChange={event => setStartMode(event.target.value as "free_play" | "drill")}><option value="free_play">Free Play: full hands with bets and payouts</option><option value="drill">Rapid Drill: decisions only, instant feedback</option></select></Field>
        </div>
         <p className="form-hint">{startMode === "drill" ? "One line at a time. Nothing is bet from your wallet." : "Bets and payouts come from the wallet you choose."}</p>
        <div className="form-actions"><button className="btn secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="btn gold" type="submit" disabled={busy}>{busy ? "Preparing…" : "Prepare session"}</button></div>
      </form>}
      {modal === "wallet" && <form onSubmit={event => void createWallet(event)}><div className="form-grid">
        <Field label="Wallet name"><input aria-label="Wallet name" required maxLength={100} value={walletName} onChange={event => setWalletName(event.target.value)} placeholder="e.g. Cruise practice" /></Field>
        <Field label="Starting balance (USD)"><input aria-label="Starting balance" inputMode="decimal" value={initialAmount} onChange={event => setInitialAmount(event.target.value)} placeholder="500.00" /></Field>
      </div><p className="form-hint">Wallets hold practice credits for tracking your bankroll. They are not real money and can't be bought or cashed out.</p><div className="form-actions"><button className="btn secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create wallet"}</button></div></form>}
      {modal === "rename" && <form onSubmit={event => void renameWallet(event)}><Field label="Wallet name"><input aria-label="Wallet name" required maxLength={100} value={walletName} onChange={event => setWalletName(event.target.value)} /></Field><div className="form-actions"><button className="btn secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save name"}</button></div></form>}
      {(modal === "topup" || modal === "transfer") && <form onSubmit={event => void topupWallet(event)}><div className="form-grid">
        {modal === "transfer" && <Field label="Transfer to"><select aria-label="Transfer to wallet" required value={transferTarget} onChange={event => setTransferTarget(event.target.value)}>{wallets.filter(wallet => wallet.id !== walletTarget).map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {money(wallet.balanceCents)}</option>)}</select></Field>}
        <Field label="Amount (USD)"><input aria-label="Amount in dollars" inputMode="decimal" required value={amountInput} onChange={event => setAmountInput(event.target.value)} placeholder="25.00" /></Field>
      </div><div className="form-actions"><button className="btn secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="btn" type="submit" disabled={busy || (modal === "transfer" && wallets.length < 2)}>{busy ? "Saving…" : modal === "topup" ? "Add credits" : "Transfer credits"}</button></div></form>}
    </Modal>}
  </div>;
}

export default App;
