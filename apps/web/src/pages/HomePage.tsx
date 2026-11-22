import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { Machine, Session, Wallet } from "@perfect-draw/shared";
import { dateTime, familyName, modeName, money, plural } from "../components/UiHelpers";
import { FELTS } from "../components/Felt";

export function HomePage({ machines, wallets, sessions, machine, selectedMachine, busy, onSelect, onCreate, onEdit, onDelete, onStart, onWallets }: {
  machines: Machine[]; wallets: Wallet[]; sessions: Record<string, Session>; machine?: Machine;
  selectedMachine: number; busy: boolean; onSelect: (index: number) => void; onCreate: () => void;
  onEdit: (machine: Machine) => void; onDelete: (machine: Machine) => void; onStart: (machine: Machine) => void; onWallets: () => void;
}) {
  const table = machine ? PAY_TABLE_LIBRARY.find(item => item.id === machine.paytableId) : undefined;
  const openCount = Object.values(sessions).filter(session => session.status !== "closed").length;
  if (!wallets.length) return <><div className="page-heading"><div><p className="eyebrow">WELCOME TO PERFECT DRAW</p><h1>Start with a<br />bankroll.</h1></div><p className="heading-note">Set a starting balance, add a machine, and start playing.</p></div><div className="empty-state"><div className="empty-mark" aria-hidden="true">01</div><h2>No wallets yet</h2><p>A wallet tracks your practice bankroll as you play. Credits are for practice only: no real money, no purchases, no cash value.</p><button className="btn gold" type="button" onClick={onWallets}>Set up a wallet</button></div></>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">MACHINES</p><h1>Tables, set your way.</h1></div><p className="heading-note">Play full hands in Free Play, or sharpen decisions in Rapid Drill.</p></div>
    {machines.length === 0 ? <div className="empty-state"><div className="empty-mark" aria-hidden="true">02</div><h2>No machines yet</h2><p>Add a machine with the game, pay table and bet you want to practice.</p><button className="btn" type="button" onClick={onCreate}>Create machine configuration</button></div> : <div className="layout-grid">
      <section className="panel machine-feature" aria-label="Machine configuration carousel">
        <div className="machine-visual" data-felt={machine?.theme ?? "felt"}>
          <div className="machine-top"><span className="meta">MACHINE {selectedMachine + 1} OF {machines.length}</span><span className="meta">{table ? familyName(table.familyId).toUpperCase() : "CUSTOM GAME"}</span></div>
          <div className="machine-display" aria-label={`${machine?.name ?? "Machine"} preview`}>
            {["A", "K", "Q", "J", "10"].map(rank => <div className="display-token" key={rank} aria-hidden="true">{rank}<span style={{ fontSize: ".52em", marginLeft: 2 }}>♥</span></div>)}
          </div>
          <div className="machine-bottom"><div><span className="meta">{table?.name ?? "Custom pay table"}</span><h2>{machine?.name}</h2></div><span className="meta">{(FELTS.find(item => item.id === machine?.theme)?.name ?? "Casino green").toUpperCase()}</span></div>
        </div>
        <div className="machine-details">
          <div className="detail-grid">
            <div className="detail"><label>Pay table</label><strong>{table?.name ?? "Custom pay table"}</strong></div>
            <div className="detail"><label>Game</label><strong>{table ? familyName(table.familyId) : "Custom"}</strong></div>
            <div className="detail"><label>Denomination</label><strong>{money(machine?.denominationCents ?? 0)}</strong></div>
            <div className="detail"><label>Bet</label><strong>{plural(machine?.coins ?? 0, "coin")} × {plural(machine?.lines ?? 0, "line")}</strong></div>
            <div className="detail"><label>Default wallet</label><strong>{wallets.find(wallet => wallet.id === machine?.defaultWalletId)?.name ?? "Unavailable"}</strong></div>
            <div className="detail"><label>Sessions open</label><strong>{openCount}</strong></div>
          </div>
          {(machine?.casinoName || machine?.location || machine?.notes) && <div className="detail" style={{ marginTop: 17 }}><label>Notes</label><strong>{[machine.casinoName, machine.location, machine.notes].filter(Boolean).join(" · ")}</strong></div>}
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
        <button className="btn add-machine-btn" type="button" onClick={onCreate}>+ New machine</button>
        <section className="panel panel-pad"><div className="panel-title"><div><h2>Your wallets</h2></div><a href="#/wallets" className="text-button">Manage</a></div>{wallets.slice(0, 3).map(wallet => <div className="list-row" key={wallet.id}><div className="list-main"><strong>{wallet.name}</strong></div><span className="wallet-balance">{money(wallet.balanceCents)}</span></div>)}<button className="btn secondary small" type="button" onClick={onWallets}>Wallets & ledger</button></section>
      </aside>
    </div>}
    {Object.keys(sessions).length > 0 && <section className="panel panel-pad" style={{ marginTop: 20 }}><div className="panel-title"><div><p className="eyebrow">RECENT</p><h2>Recent sessions</h2></div><a href="#/session" className="text-button">Open session room</a></div>{Object.values(sessions).sort((a, b) => b.startedAt - a.startedAt).slice(0, 4).map(item => <div className="list-row" key={item.id}><div className="list-main"><strong>{item.machineSnapshot.name} · {modeName(item.mode)}</strong><span>{dateTime(item.startedAt)} · {item.status === "active" ? "In play" : item.status === "paused" ? "Paused" : "Closed"}</span></div>{item.status !== "closed" && <a href="#/session" className="text-button">Continue</a>}</div>)}</section>}
  </>;
}
