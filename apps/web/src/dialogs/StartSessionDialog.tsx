import { useState } from "react";
import type { FormEvent } from "react";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { Machine, Wallet } from "@perfect-draw/shared";
import { Field, Modal, money, plural } from "../components/UiHelpers";
import { sessionService } from "../services/sessions";
import type { Run } from "../hooks/useActionRunner";

export function StartSessionDialog({ machine, wallets, busy, run, onStarted, onClose, initialMode = "free_play", reason }: {
  machine: Machine; wallets: Wallet[]; busy: boolean; run: Run; onStarted: () => void; onClose: () => void;
  initialMode?: "free_play" | "drill"; /** Why the one-click start needs a choice, e.g. the default wallet is short. */ reason?: string;
}) {
  const [walletId, setWalletId] = useState(wallets.some(wallet => wallet.id === machine.defaultWalletId) ? machine.defaultWalletId : wallets[0]?.id ?? "");
  const [mode, setMode] = useState<"free_play" | "drill">(initialMode);
  const [error, setError] = useState("");

  async function start(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!walletId) { setError("Choose a wallet."); return; }
    await run(async () => {
      await sessionService.start({ machineId: machine.id, walletId, mode });
      onStarted();
    }, { onError: setError });
  }

  return <Modal error={error} title="Choose a wallet" subtitle={reason ?? "Pick the wallet and mode for this session."} onClose={onClose}>
    <form onSubmit={event => void start(event)}>
      <div className="terms-box"><strong>{machine.name}</strong> · {PAY_TABLE_LIBRARY.find(table => table.id === machine.paytableId)?.name ?? "Custom pay table"} · {money(machine.denominationCents)} · {plural(machine.coins, "coin")} × {plural(machine.lines, "line")}</div>
      <div className="form-grid">
        <Field label="Wallet"><select aria-label="Practice wallet" required value={walletId} onChange={event => setWalletId(event.target.value)}>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {money(wallet.balanceCents)}</option>)}</select></Field>
        <Field label="Session mode"><select aria-label="Session mode" value={mode} onChange={event => setMode(event.target.value as "free_play" | "drill")}><option value="free_play">Free Play: full hands with bets and payouts</option><option value="drill">Rapid Drill: decisions only, instant feedback</option></select></Field>
      </div>
      <p className="form-hint">{mode === "drill" ? "One line at a time. Nothing is bet from your wallet." : "Bets and payouts come from the wallet you choose."}</p>
      <div className="form-actions"><button className="btn secondary" type="button" onClick={onClose}>Cancel</button><button className="btn gold" type="submit" disabled={busy}>{busy ? "Starting…" : "Start session"}</button></div>
    </form>
  </Modal>;
}
