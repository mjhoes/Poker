import { useState } from "react";
import type { FormEvent } from "react";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { Machine, Wallet } from "@perfect-draw/shared";
import { Field, Modal, money, plural } from "../components/UiHelpers";
import { sessionService } from "../services/sessions";
import type { Run } from "../hooks/useActionRunner";

export function StartSessionDialog({ machine, wallets, busy, run, onStarted, onClose }: {
  machine: Machine; wallets: Wallet[]; busy: boolean; run: Run; onStarted: () => void; onClose: () => void;
}) {
  const [walletId, setWalletId] = useState(machine.defaultWalletId);
  const [mode, setMode] = useState<"free_play" | "drill">("free_play");
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

  return <Modal error={error} title="Prepare a session" subtitle="Choose how you want to play this machine." onClose={onClose}>
    <form onSubmit={event => void start(event)}>
      <div className="terms-box"><strong>{machine.name}</strong> · {PAY_TABLE_LIBRARY.find(table => table.id === machine.paytableId)?.name ?? "Custom pay table"} · {money(machine.denominationCents)} · {plural(machine.coins, "coin")} × {plural(machine.lines, "line")}</div>
      <div className="form-grid">
        <Field label="Wallet"><select aria-label="Practice wallet" required value={walletId} onChange={event => setWalletId(event.target.value)}>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {money(wallet.balanceCents)}</option>)}</select></Field>
        <Field label="Session mode"><select aria-label="Session mode" value={mode} onChange={event => setMode(event.target.value as "free_play" | "drill")}><option value="free_play">Free Play: full hands with bets and payouts</option><option value="drill">Rapid Drill: decisions only, instant feedback</option></select></Field>
      </div>
      <p className="form-hint">{mode === "drill" ? "One line at a time. Nothing is bet from your wallet." : "Bets and payouts come from the wallet you choose."}</p>
      <div className="form-actions"><button className="btn secondary" type="button" onClick={onClose}>Cancel</button><button className="btn gold" type="submit" disabled={busy}>{busy ? "Preparing…" : "Prepare session"}</button></div>
    </form>
  </Modal>;
}
