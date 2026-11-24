import { useState } from "react";
import type { FormEvent } from "react";
import type { Wallet } from "@perfect-draw/shared";
import { Field, Modal, money } from "../components/UiHelpers";
import { walletService } from "../services/wallets";
import { parseCents } from "../services/money";
import type { Run } from "../hooks/useActionRunner";

type DialogProps = { busy: boolean; run: Run; onClose: () => void };

function Actions({ busy, label, busyLabel, disabled, onClose }: { busy: boolean; label: string; busyLabel: string; disabled?: boolean; onClose: () => void }) {
  return <div className="form-actions"><button className="btn secondary" type="button" onClick={onClose}>Cancel</button><button className="btn" type="submit" disabled={busy || disabled}>{busy ? busyLabel : label}</button></div>;
}

export function NewWalletDialog({ busy, run, onClose, onCreated }: DialogProps & { onCreated: (walletId: string) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    const cents = amount.trim() === "" ? 0 : parseCents(amount, true);
    if (cents === null) { setError("Enter a non-negative amount with no more than two decimal places."); return; }
    await run(async () => {
      const wallet = await walletService.create({ name: name.trim(), initialCents: cents });
      onCreated(wallet.id);
      onClose();
    }, { success: "Wallet created.", onError: setError });
  }
  return <Modal error={error} title="New wallet" onClose={onClose}>
    <form onSubmit={event => void create(event)}>
      <div className="form-grid">
        <Field label="Wallet name"><input aria-label="Wallet name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Cruise practice" /></Field>
        <Field label="Starting balance (USD)"><input aria-label="Starting balance" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="500.00" /></Field>
      </div>
      <p className="form-hint">Wallets hold practice credits for tracking your bankroll. They are not real money and can't be bought or cashed out.</p>
      <Actions busy={busy} label="Create wallet" busyLabel="Creating…" onClose={onClose} />
    </form>
  </Modal>;
}

export function RenameWalletDialog({ wallet, busy, run, onClose }: DialogProps & { wallet: Wallet }) {
  const [name, setName] = useState(wallet.name);
  const [error, setError] = useState("");
  async function rename(event: FormEvent) {
    event.preventDefault();
    setError("");
    await run(async () => { await walletService.rename(wallet.id, name.trim()); onClose(); }, { success: "Wallet renamed.", onError: setError });
  }
  return <Modal error={error} title="Rename wallet" onClose={onClose}>
    <form onSubmit={event => void rename(event)}>
      <Field label="Wallet name"><input aria-label="Wallet name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
      <Actions busy={busy} label="Save name" busyLabel="Saving…" onClose={onClose} />
    </form>
  </Modal>;
}

/** Add credits to a wallet, or move credits between two wallets. */
export function WalletAmountDialog({ kind, wallet, wallets, busy, run, onClose }: DialogProps & { kind: "topup" | "transfer"; wallet: Wallet; wallets: Wallet[] }) {
  const others = wallets.filter(item => item.id !== wallet.id);
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const cents = parseCents(amount);
    if (!cents) { setError("Enter an amount greater than $0.00 with no more than two decimal places."); return; }
    await run(async () => {
      if (kind === "topup") await walletService.topup({ walletId: wallet.id, amountCents: cents });
      else await walletService.transfer({ fromId: wallet.id, toId: target, amountCents: cents });
      onClose();
    }, { success: kind === "topup" ? "Credits added." : "Transfer complete.", onError: setError });
  }
  return <Modal error={error} title={kind === "topup" ? "Add credits" : "Transfer credits"} onClose={onClose}>
    <form onSubmit={event => void submit(event)}>
      <div className="form-grid">
        {kind === "transfer" && <Field label="Transfer to"><select aria-label="Transfer to wallet" required value={target} onChange={event => setTarget(event.target.value)}>{others.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.balanceCents)}</option>)}</select></Field>}
        <Field label="Amount (USD)"><input aria-label="Amount in dollars" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="25.00" /></Field>
      </div>
      <Actions busy={busy} label={kind === "topup" ? "Add credits" : "Transfer credits"} busyLabel="Saving…" disabled={kind === "transfer" && wallets.length < 2} onClose={onClose} />
    </form>
  </Modal>;
}
