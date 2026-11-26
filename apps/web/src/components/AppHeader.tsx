import type { Session } from "@perfect-draw/shared";
import { Badge } from "./ui";
import { creditLabel, sessionModeName, money } from "./UiHelpers";
import { Icon } from "./Icons";
import type { Route } from "../hooks/useRoute";

const NAV: { route: Route; label: string }[] = [
  { route: "/", label: "Machines" },
  { route: "/wallets", label: "Wallets" },
  { route: "/session", label: "Session room" },
  { route: "/analyze", label: "Analyze" },
  { route: "/train", label: "Train" },
  { route: "/stats", label: "Statistics" },
  { route: "/cruise", label: "Cruise" },
  { route: "/settings", label: "Settings" },
];

export function AppHeader({ route, openSessions, activeSessionId, onSelectSession, bankrollCents }: {
  route: Route; openSessions: Session[]; activeSessionId: string | null; onSelectSession: (id: string) => void;
  /** Total across wallets; null before the first wallet exists. */ bankrollCents: number | null;
}) {
  return <header className="app-header">
    <div className="header-inner">
      <a className="brand" href="#/" aria-label="Perfect Draw home"><img className="brand-mark" src="/icon.svg" alt="" width="34" height="34" /><span className="brand-name">PERFECT DRAW</span></a>
      <nav className="nav-links" aria-label="Main navigation">
        {NAV.map(item => <a key={item.route} className={`nav-link ${route === item.route ? "active" : ""}`} href={`#${item.route}`}>{item.label}</a>)}
      </nav>
      {bankrollCents !== null && <a className="bankroll-chip" href="#/wallets" aria-label={`Bankroll ${money(bankrollCents)}. Open wallets.`}>
        <Icon name="wallet" size={16} /><span className="bankroll-label">Bankroll</span><strong>{money(bankrollCents)}</strong>
      </a>}
    </div>
    {openSessions.length > 0 && <div className="session-rail" aria-label="Open sessions">
      <span className="rail-label">OPEN SESSIONS</span>
      {openSessions.map((session, index) => {
        const config = session.machineSnapshot;
        const creditsCount = creditLabel(session.state);
        const amount = money(Math.round(session.state.credits * config.denominationCents) + session.state.creditRemainderCents);
        const active = session.id === activeSessionId;
        return <button key={session.id} type="button" className={`session-chip ${active ? "selected" : ""}`} aria-label={`Select session ${index + 1}: ${config.name}, ${creditsCount} (${amount}), ${sessionModeName(session)}, ${session.status}${active ? ", active" : ""}`} onClick={() => onSelectSession(session.id)}>
          <span className={`chip-state ${session.status === "paused" ? "paused" : ""}`} />
          <span className="chip-name">{config.name}</span>
          <span className="chip-meta">{creditsCount} · {amount} · {sessionModeName(session)}</span>
          {session.status === "paused" && <Badge tone="warning">Paused</Badge>}
        </button>;
      })}
      <span className="chip-meta rail-hint" aria-hidden="true">CTRL + 1–9</span>
    </div>}
  </header>;
}
