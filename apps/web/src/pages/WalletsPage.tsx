import { useEffect } from "react";
import { Button } from "../components/ui";
import type { Wallet, WalletLedger } from "@perfect-draw/shared";
import { dateTime, money } from "../components/UiHelpers";

export function WalletsPage({ wallets, selectedWallet, ledger, onSelect, onCreate, onRename, onTopup, onTransfer, busy }: {
  wallets: Wallet[]; selectedWallet: string; ledger: WalletLedger[]; onSelect: (id: string) => void; onCreate: () => void;
  onRename: (wallet: Wallet) => void; onTopup: (wallet: Wallet) => void; onTransfer: (wallet: Wallet) => void; busy: boolean;
}) {
  const chosen = wallets.find(wallet => wallet.id === selectedWallet) ?? wallets[0];
  useEffect(() => { if (chosen && chosen.id !== selectedWallet) onSelect(chosen.id); }, [chosen?.id, selectedWallet, onSelect]);
  return <><div className="page-heading"><div><p className="eyebrow">WALLETS</p><h1>Your bankroll, clearly kept.</h1></div><p className="heading-note">Every bet, win, top-up and transfer is recorded.</p></div>
    {!wallets.length ? <div className="empty-state"><div className="empty-mark" aria-hidden="true">W</div><h2>Set up your first wallet</h2><p>Give your bankroll a name and a starting balance.</p><button type="button" className="btn gold" onClick={onCreate}>Set up a wallet</button></div> : <div className="wallet-layout">
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}><span className="eyebrow">YOUR WALLETS · {wallets.length}</span><Button variant="secondary" size="sm" icon="plus" onClick={onCreate}>New wallet</Button></div>
        <div className="wallet-main-list">{wallets.map(wallet => <article key={wallet.id} className={`panel wallet-card ${chosen?.id === wallet.id ? "selected" : ""}`}>
          <button type="button" className="wallet-select" aria-label={`Select wallet ${wallet.name}`} aria-pressed={chosen?.id === wallet.id} onClick={() => onSelect(wallet.id)}>
            <span className="detail"><span className="detail-label">WALLET</span><strong>{wallet.name}</strong></span><span className="wallet-balance">{money(wallet.balanceCents)}</span>
          </button>
          <div className="wallet-actions">
            <Button variant="secondary" size="sm" icon="edit" onClick={() => onRename(wallet)}>Rename</Button>
            <Button variant="secondary" size="sm" icon="plus" onClick={() => onTopup(wallet)}>Add credits</Button>
            <Button variant="secondary" size="sm" icon="transfer" disabled={wallets.length < 2 || busy} onClick={() => onTransfer(wallet)}>Transfer</Button>
          </div>
        </article>)}</div>
      </section>
      <section className="panel panel-pad">
        <div className="panel-title"><div><p className="eyebrow">ACTIVITY</p><h2>{chosen?.name ?? "Wallet activity"}</h2></div><span className="wallet-balance">{money(chosen?.balanceCents ?? 0)}</span></div>
        {!ledger.length ? <div className="empty-state"><div className="empty-mark" aria-hidden="true">—</div><h2>No activity yet</h2><p>Add credits to give this wallet a balance.</p><button className="btn gold" type="button" onClick={() => chosen && onTopup(chosen)}>Add credits</button></div> :
          <div style={{ overflowX: "auto" }}><table className="ledger"><thead><tr><th>When</th><th>Entry</th><th>Amount</th><th>Balance</th></tr></thead><tbody>{ledger.map(row => <tr key={row.id}><td>{dateTime(row.createdAt)}</td><td>{row.type === "topup" ? "Credits added" : row.type === "transfer" ? "Transfer" : row.type === "bet" ? "Bet" : row.type === "win" ? "Win" : "Adjustment"}</td><td className={row.amountCents < 0 ? "negative" : "positive"}>{row.amountCents < 0 ? "−" : "+"}{money(Math.abs(row.amountCents))}</td><td>{money(row.balanceAfterCents)}</td></tr>)}</tbody></table></div>}
      </section>
    </div>}</>;
}
