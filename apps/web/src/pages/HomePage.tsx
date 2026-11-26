import { useState } from "react";
import type { Machine, Session, Wallet } from "@perfect-draw/shared";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { dateTime, sessionModeName, money } from "../components/UiHelpers";
import { Badge, Button, ChoiceChips, MenuButton } from "../components/ui";
import { parseCents } from "../services/money";
import { MachineCabinet, NewMachineTile } from "../machines/MachineCabinet";
import { STARTER_MACHINES, useLibraryReturns } from "../machines/machine-info";

const BANKROLLS = ["10000", "50000", "100000", "custom"] as const;
type BankrollChoice = typeof BANKROLLS[number];

/** First run: pick a starting bankroll and go. One of the three places the practice-credits note appears. */
function Welcome({ busy, onCreateBankroll }: { busy: boolean; onCreateBankroll: (cents: number) => void }) {
  const [choice, setChoice] = useState<BankrollChoice>("50000");
  const [custom, setCustom] = useState("");
  const customCents = parseCents(custom);
  const cents = choice === "custom" ? customCents : Number(choice);
  return <section className="welcome" data-felt="felt">
    <div className="welcome-art" aria-hidden="true">
      <MachineCabinet preview machine={{ name: "Perfect Draw", paytableId: PAY_TABLE_LIBRARY[0]?.id ?? "", denominationCents: 25, coins: 5, lines: 1, theme: "felt" }} />
    </div>
    <div className="welcome-copy">
      <p className="eyebrow">Welcome to Perfect Draw</p>
      <h1>Practice perfect video poker.</h1>
      <p className="welcome-lede">Every hand is checked against the exact best play for the machine's pay table. Start with a bankroll, pick a machine, and play.</p>
      <p className="field-label">Starting bankroll</p>
      <ChoiceChips label="Starting bankroll" value={choice} onChange={setChoice} choices={[
        { value: "10000", label: "$100" }, { value: "50000", label: "$500" }, { value: "100000", label: "$1,000" }, { value: "custom", label: "Other" },
      ]} />
      {choice === "custom" && <label className="field welcome-custom"><span className="field-label">Amount (USD)</span>
        <input aria-label="Starting bankroll amount" inputMode="decimal" placeholder="250.00" value={custom} onChange={event => setCustom(event.target.value)} autoFocus /></label>}
      <Button variant="gold" icon="play" className="welcome-start" disabled={busy || !cents} onClick={() => cents && onCreateBankroll(cents)}>
        {cents ? `Start with ${money(cents)}` : "Enter an amount"}
      </Button>
      <p className="welcome-note">Credits are for practice only: no real money, no purchases, no cash value. Everything stays on this device.</p>
    </div>
  </section>;
}

export function HomePage({ machines, wallets, sessions, busy, onCreate, onEdit, onDuplicate, onDelete, onPlay, onPlayWithWallet, onCreateBankroll, onAddStarter }: {
  machines: Machine[]; wallets: Wallet[]; sessions: Record<string, Session>; busy: boolean;
  onCreate: () => void; onEdit: (machine: Machine) => void; onDuplicate: (machine: Machine) => void; onDelete: (machine: Machine) => void;
  onPlay: (machine: Machine, mode: "free_play" | "drill") => void; onPlayWithWallet: (machine: Machine) => void;
  onCreateBankroll: (cents: number) => void; onAddStarter: (slug: string) => void;
}) {
  const returns = useLibraryReturns();
  if (!wallets.length) return <Welcome busy={busy} onCreateBankroll={onCreateBankroll} />;
  const openSessions = Object.values(sessions).filter(session => session.status !== "closed");
  const recent = Object.values(sessions).sort((a, b) => b.startedAt - a.startedAt).slice(0, 4);

  return <>
    <div className="page-heading floor-heading">
      <div><p className="eyebrow">Machines</p><h1>{machines.length ? "Pick a machine." : "Pick your first machine."}</h1></div>
    </div>

    {machines.length === 0 ? <section className="starters" aria-label="Suggested machines">
      <p className="starters-lede">Start with a classic, or build your own. You can change everything later.</p>
      <div className="floor">
        {STARTER_MACHINES.map(starter => {
          const table = PAY_TABLE_LIBRARY.find(item => item.slug === starter.slug);
          if (!table) return null;
          const theme = starter.slug.startsWith("double") ? "midnight" : starter.slug.startsWith("deuces") ? "royal" : "felt";
          return <MachineCabinet key={starter.slug} returnPct={returns.get(table.id)}
            machine={{ name: table.name, paytableId: table.id, denominationCents: 25, coins: 5, lines: 1, theme }}
            note={starter.blurb}
            actions={<Button variant="gold" icon="plus" disabled={busy} onClick={() => onAddStarter(starter.slug)} aria-label={`Add ${table.name}`}>Add machine</Button>} />;
        })}
        <NewMachineTile onClick={onCreate} />
      </div>
    </section> : <div className="floor">
      {machines.map(machine => {
        const open = openSessions.filter(session => session.machineId === machine.id);
        const free = open.find(session => session.mode === "free_play");
        const drill = open.find(session => session.mode === "drill");
        const shown = free ?? drill;
        const value = shown ? money(Math.round(shown.state.credits * shown.machineSnapshot.denominationCents) + shown.state.creditRemainderCents) : "";
        const status = shown ? <Badge tone={shown.status === "paused" ? "warning" : "success"} dot>
          {shown.status === "paused" ? "Paused" : "In play"} · {shown.mode === "drill" ? "drill" : value}
        </Badge> : undefined;
        return <MachineCabinet key={machine.id} machine={machine} returnPct={returns.get(machine.paytableId)} status={status} actions={<>
          <Button variant="gold" icon="play" disabled={busy} onClick={() => onPlay(machine, "free_play")} title={free ? "Continue your open session" : "Start Free Play with the machine's wallet"}>{free ? "Continue" : "Play"}</Button>
          <Button variant="secondary" icon="cards" disabled={busy} onClick={() => onPlay(machine, "drill")} title={drill ? "Continue your open drill" : "Practice decisions without betting"}>Drill</Button>
          <MenuButton label={`More actions for ${machine.name}`} items={[
            { label: "Edit", icon: "edit", onSelect: () => onEdit(machine) },
            { label: "Duplicate", icon: "copy", onSelect: () => onDuplicate(machine) },
            { label: "Play with another wallet…", icon: "wallet", disabled: wallets.length < 2, onSelect: () => onPlayWithWallet(machine) },
            { label: "Delete", icon: "trash", tone: "danger", onSelect: () => onDelete(machine) },
          ]} />
        </>} />;
      })}
      <NewMachineTile onClick={onCreate} />
    </div>}

    {recent.length > 0 && <section className="panel panel-pad recent-sessions">
      <div className="panel-title"><div><p className="eyebrow">Recent</p><h2>Recent sessions</h2></div><a href="#/session" className="text-button">Open session room</a></div>
      {recent.map(item => <div className="list-row" key={item.id}>
        <div className="list-main"><strong>{item.machineSnapshot.name} · {sessionModeName(item)}</strong><span>{dateTime(item.startedAt)}</span></div>
        <Badge tone={item.status === "active" ? "success" : item.status === "paused" ? "warning" : "neutral"}>{item.status === "active" ? "In play" : item.status === "paused" ? "Paused" : "Closed"}</Badge>
      </div>)}
    </section>}
  </>;
}
