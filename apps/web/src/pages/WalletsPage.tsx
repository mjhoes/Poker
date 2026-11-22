import { useEffect } from "react";
import type { Wallet, WalletLedger } from "@perfect-draw/shared";
import { dateTime, money } from "../components/UiHelpers";

export function WalletsPage({ wallets, selectedWallet, ledger, onSelect, onCreate, onRename, onTopup, onTransfer, busy }: {
  wallets: Wallet[]; selectedWallet: string; ledger: WalletLedger[]; onSelect: (id: string) => void; onCreate: () => void;
  onRename: (wallet: Wallet) => void; onTopup: (wallet: Wallet) => void; onTransfer: (wallet: Wallet) => void; busy: boolean;
}) {
  const chosen = wallets.find(wallet => wallet.id === selectedWallet) ?? wallets[0];
  useEffect(() => { if (chosen && chosen.id !== selectedWallet) onSelect(chosen.id); }, [chosen?.id, selectedWallet, onSelect]);
  return <><div className="page-heading"><div><p className="eyebrow">PRACTICE BANKROLL</p><h1>Play money. Clear books.</h1></div><p className="heading-note">Every balance is a local ledger total. Top-ups and transfers create records; session credit displays follow the wallet balance.</p></div>
    {!wallets.length ? <div className="empty-state"><div className="empty-mark" aria-hidden="true">W</div><h2>Set up your first wallet</h2><p>Name a practice bankroll and optionally add an opening play-money balance. It is never real money and has no purchase path.</p><button type="button" className="btn gold" onClick={onCreate}>Create play-money wallet</button></div> : <div className="wallet-layout">
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}><span className="eyebrow">YOUR WALLETS · {wallets.length}</span><button className="btn secondary small" type="button" onClick={onCreate}>+ New wallet</button></div>
        <div className="wallet-main-list">{wallets.map(wallet => <article key={wallet.id} className={`panel wallet-card ${chosen?.id === wallet.id ? "selected" : ""}`}>
          <button type="button" className="wallet-select" aria-label={`Select wallet ${wallet.name}`} aria-pressed={chosen?.id === wallet.id} onClick={() => onSelect(wallet.id)}>
            <span className="detail"><span className="detail-label">PLAY-MONEY WALLET</span><strong>{wallet.name}</strong></span><span className="wallet-balance">{money(wallet.balanceCents)}</span>
          </button>
          <div className="wallet-actions">
            <button className="btn secondary small" type="button" onClick={() => onRename(wallet)}>Rename</button>
            <button className="btn secondary small" type="button" onClick={() => onTopup(wallet)}>Top up</button>
            <button className="btn secondary small" type="button" disabled={wallets.length < 2 || busy} onClick={() => onTransfer(wallet)}>Transfer</button>
          </div>
        </article>)}</div>
      </section>
      <section className="panel panel-pad">
        <div className="panel-title"><div><p className="eyebrow">ACCOUNT LEDGER</p><h2>{chosen?.name ?? "Wallet activity"}</h2><p>Signed amounts and resulting balances; entries are retained.</p></div><span className="wallet-balance">{money(chosen?.balanceCents ?? 0)}</span></div>
        {!ledger.length ? <div className="empty-state"><div className="empty-mark" aria-hidden="true">—</div><h2>No ledger entries yet</h2><p>This wallet has no recorded top-ups or transfers. Add play-money credits to establish your practice balance.</p><button className="btn gold" type="button" onClick={() => chosen && onTopup(chosen)}>Record a top-up</button></div> :
          <div style={{ overflowX: "auto" }}><table className="ledger"><thead><tr><th>When</th><th>Entry</th><th>Amount</th><th>Balance</th></tr></thead><tbody>{ledger.map(row => <tr key={row.id}><td>{dateTime(row.createdAt)}</td><td>{row.type === "topup" ? "Top-up" : row.type === "transfer" ? "Transfer" : row.type === "bet" ? "Practice bet" : row.type === "win" ? "Practice win" : "Adjustment"}</td><td className={row.amountCents < 0 ? "negative" : "positive"}>{row.amountCents < 0 ? "−" : "+"}{money(Math.abs(row.amountCents))}</td><td>{money(row.balanceAfterCents)}</td></tr>)}</tbody></table></div>}
        <div className="warning-card">All amounts are simulated practice credits. No real-money deposits, cash-outs, or purchases are available.</div>
      </section>
    </div>}</>;
}
