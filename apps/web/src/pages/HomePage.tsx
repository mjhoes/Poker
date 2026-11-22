import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { Machine, Session, Wallet } from "@perfect-draw/shared";
import { dateTime, familyName, modeName, money } from "../components/UiHelpers";

export function HomePage({ machines, wallets, sessions, machine, selectedMachine, busy, onSelect, onCreate, onEdit, onDelete, onStart, onWallets }: {
  machines: Machine[]; wallets: Wallet[]; sessions: Record<string, Session>; machine?: Machine;
  selectedMachine: number; busy: boolean; onSelect: (index: number) => void; onCreate: () => void;
  onEdit: (machine: Machine) => void; onDelete: (machine: Machine) => void; onStart: (machine: Machine) => void; onWallets: () => void;
}) {
  const table = machine ? PAY_TABLE_LIBRARY.find(item => item.id === machine.paytableId) : undefined;
  const openCount = Object.values(sessions).filter(session => session.status !== "closed").length;
  if (!wallets.length) return <><div className="page-heading"><div><p className="eyebrow">YOUR PRIVATE PRACTICE ROOM</p><h1>Start with a<br />practice bankroll.</h1></div><p className="heading-note">Keep the numbers honest. Credits live in a local ledger, and configurations stay attached to the wallet you choose.</p></div><div className="empty-state"><div className="empty-mark" aria-hidden="true">01</div><h2>No wallets yet</h2><p>Create a play-money wallet first. Then you can save machine configurations and prepare sessions against one of the eight built-in paytables.</p><button className="btn gold" type="button" onClick={onWallets}>Create your first wallet</button></div><div className="note-card" style={{ marginTop: 18 }}><h3>Not a casino. Not real money.</h3><p>Perfect Draw is a personal video-poker training tool. Wallet amounts are play-money tracking only; there are no purchases or cash value.</p></div></>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">YOUR PRIVATE PRACTICE ROOM</p><h1>Tables, set your way.</h1></div><p className="heading-note">Pick a precise paytable, set your stakes, and keep a clear record of the practice session you prepared.</p></div>
    {machines.length === 0 ? <div className="empty-state"><div className="empty-mark" aria-hidden="true">02</div><h2>No machine configurations</h2><p>Wallet ready. Now save a table with its exact denomination, coin count, and paytable. Nothing starts until you choose to prepare a session.</p><button className="btn" type="button" onClick={onCreate}>Create machine configuration</button></div> : <div className="layout-grid">
      <section className="panel machine-feature" aria-label="Machine configuration carousel">
        <div className="machine-visual">
          <div className="machine-top"><span className="meta">CONFIGURATION {String(selectedMachine + 1).padStart(2, "0")} / {String(machines.length).padStart(2, "0")}</span><span className="meta">LOCAL TABLE</span></div>
          <div className="machine-display" aria-label={`${machine?.name ?? "Machine"} preview`}>
            {["A", "K", "Q", "J", "10"].map((rank, index) => <div className="display-token" key={rank} aria-hidden="true">{rank}<span style={{ fontSize: ".52em", marginLeft: 2 }}>{["♠", "♦", "♣", "♥", "♠"][index]}</span></div>)}
          </div>
          <div className="machine-bottom"><div><span className="meta">SAVED CONFIGURATION</span><h2>{machine?.name}</h2></div><span className="meta">{machine?.theme.toUpperCase()} TABLE</span></div>
        </div>
        <div className="machine-details">
          <div className="detail-grid">
            <div className="detail"><label>Paytable</label><strong>{table?.name ?? familyName(machine?.paytableId ?? "")}</strong></div>
            <div className="detail"><label>Family</label><strong>{table ? familyName(table.familyId) : "Saved table"}</strong></div>
            <div className="detail"><label>Denomination</label><strong>{money(machine?.denominationCents ?? 0)}</strong></div>
            <div className="detail"><label>Coins / lines</label><strong>{machine?.coins} coins · {machine?.lines} lines</strong></div>
            <div className="detail"><label>Default wallet</label><strong>{wallets.find(wallet => wallet.id === machine?.defaultWalletId)?.name ?? "Unavailable"}</strong></div>
            <div className="detail"><label>Sessions open</label><strong>{openCount}</strong></div>
          </div>
          {(machine?.casinoName || machine?.location || machine?.notes) && <div className="detail" style={{ marginTop: 17 }}><label>Private table note</label><strong>{[machine.casinoName, machine.location, machine.notes].filter(Boolean).join(" · ")}</strong></div>}
          <div className="machine-controls">
            <div className="carousel-control" aria-label="Configuration selection">
              <button className="icon-btn" type="button" aria-label="Previous machine" onClick={() => onSelect((selectedMachine - 1 + machines.length) % machines.length)}>‹</button>
              <div className="dots">{machines.map((item, index) => <button className={`dot-btn ${index === selectedMachine ? "active" : ""}`} key={item.id} type="button" aria-label={`Show ${item.name}`} aria-current={index === selectedMachine ? "true" : undefined} onClick={() => onSelect(index)} />)}</div>
              <button className="icon-btn" type="button" aria-label="Next machine" onClick={() => onSelect((selectedMachine + 1) % machines.length)}>›</button>
            </div>
            <div className="carousel-control"><button className="btn secondary small" type="button" onClick={() => machine && onEdit(machine)}>Edit</button><button className="btn danger small" type="button" disabled={busy} onClick={() => machine && onDelete(machine)}>Delete</button><button className="btn gold" type="button" disabled={busy} onClick={() => machine && onStart(machine)}>Prepare session</button></div>
          </div>
        </div>
      </section>
      <aside className="side-stack">
        <div className="note-card"><p className="eyebrow">ENGINE STATUS</p><h3>Exact means computed.</h3><p>When a session opens, its one active paytable loads through the verified strategy engine. No library reference percentage is presented as a computed result.</p></div>
        <section className="panel panel-pad"><div className="panel-title"><div><h2>Your wallets</h2><p>Play-money balances; no cash value.</p></div><a href="#/wallets" className="text-button">Manage</a></div>{wallets.slice(0, 3).map(wallet => <div className="list-row" key={wallet.id}><div className="list-main"><strong>{wallet.name}</strong><span>LEDGER TRACKED</span></div><span className="wallet-balance">{money(wallet.balanceCents)}</span></div>)}<button className="btn secondary small" type="button" onClick={onWallets}>Wallets & ledger</button></section>
        <button className="btn secondary" type="button" onClick={onCreate}>+ Add another configuration</button>
      </aside>
    </div>}
    {Object.keys(sessions).length > 0 && <section className="panel panel-pad" style={{ marginTop: 20 }}><div className="panel-title"><div><p className="eyebrow">SAVED PRACTICE</p><h2>Recent sessions</h2><p>Session records remain local, including the frozen table terms.</p></div><a href="#/session" className="text-button">Open session room</a></div>{Object.values(sessions).sort((a, b) => b.startedAt - a.startedAt).slice(0, 4).map(item => <div className="list-row" key={item.id}><div className="list-main"><strong>{item.machineSnapshot.name} · {modeName(item.mode)}</strong><span>{dateTime(item.startedAt)} · {item.status.toUpperCase()}</span></div>{item.status !== "closed" && <a href="#/session" className="text-button">Workspace</a>}</div>)}</section>}
  </>;
}
