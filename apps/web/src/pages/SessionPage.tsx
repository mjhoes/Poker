import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { cardRank, cardSuit } from "@perfect-draw/engine";
import type { Session } from "@perfect-draw/shared";
import type { AnalysisSummary } from "../worker/engine-api";
import { credits, dateTime, familyName, modeName, money } from "../components/UiHelpers";

export function SessionPage({ session, sessions, analysis, analysisError, analysisLoading, busy, onPause, onResume, onClose, onSelect, onHold, onRetry }: {
  session?: Session; sessions: Session[]; analysis: AnalysisSummary | null; analysisError: string; analysisLoading: boolean; busy: boolean;
  onPause: (session: Session) => void; onResume: (session: Session) => void; onClose: (session: Session) => void; onSelect: (id: string) => void;
  onHold: (session: Session, index: number) => void; onRetry: () => void;
}) {
  const cards = session?.state.hand ?? [];
  const rankLabels = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const suitLabels = ["♣", "♦", "♥", "♠"];
  const active = session && session.status !== "closed";
  return <><div className="page-heading"><div><p className="eyebrow">SESSION WORKSPACE</p><h1>{session ? session.machineSnapshot.name : "No open table."}</h1></div><p className="heading-note">{session ? `${modeName(session.mode)} · saved session · ${session.status === "paused" ? "paused" : session.status === "active" ? "active" : "closed"}. The machine terms below are the snapshot taken at session start.` : "Prepare a session from one of your machine configurations. Sessions are saved locally and can be resumed without resetting a saved hand."}</p></div>
    {!session ? <div className="empty-state"><div className="empty-mark" aria-hidden="true">S</div><h2>No open session</h2><p>Choose a saved configuration to prepare a workspace. Dealing, drawing, coaching, and Rapid Drill are intentionally not available in this phase.</p><a className="btn" href="#/">Browse machine configurations</a>{sessions.length > 0 && <div style={{ marginTop: 24, textAlign: "left" }}><p className="eyebrow">CLOSED SESSION HISTORY</p>{sessions.map(item => <div className="list-row" key={item.id}><div className="list-main"><strong>{item.machineSnapshot.name} · {modeName(item.mode)}</strong><span>{dateTime(item.startedAt)} · {item.summary.hands} saved hands</span></div><button className="text-button" type="button" onClick={() => onSelect(item.id)}>View saved record</button></div>)}</div>}</div> :
      <div className="session-workspace">
        <section>
          <div className="session-table">
            <div className="session-table-top"><span>{session.machineSnapshot.name}</span><span>{session.status.toUpperCase()} · {modeName(session.mode)}</span></div>
            {cards.length === 5 ? <><div>
              <div className="hand-cards" role="group" aria-label="Saved hand. Toggle cards to save hold selections.">
                {cards.map((card, index) => {
                  const rank = rankLabels[cardRank(card)]; const suitIndex = cardSuit(card); const suit = suitLabels[suitIndex]; const held = (session.state.heldMask & (1 << index)) !== 0;
                  return <button key={`${card}-${index}`} type="button" className={`hand-card ${suitIndex === 1 || suitIndex === 2 ? "red-suit" : ""} ${held ? "held" : ""}`} disabled={!active || session.status !== "active" || session.state.phase !== "holding" || busy} aria-pressed={held} aria-label={`${rank} of ${["clubs", "diamonds", "hearts", "spades"][suitIndex] ?? "clubs"}, ${held ? "held" : "not held"}. ${!active || session.status !== "active" ? "Resume session to edit hold." : "Toggle hold."}`} onClick={() => onHold(session, index)}>
                    <span className="card-corner">{rank}<br /><span style={{ fontSize: ".78em" }}>{suit}</span></span><span className="card-suit" aria-hidden="true">{suit}</span><span className="hold-caption">{held ? "HELD" : "HOLD"}</span>
                  </button>;
                })}
              </div>
              <p className="hold-caption" style={{ color: "#cbd8cc", textAlign: "center" }}>{session.state.phase === "holding" ? "SAVED HAND · HOLD SELECTIONS SAVE IMMEDIATELY" : "SAVED HAND · HELD BUTTONS ARE AVAILABLE WHEN A HOLDING-PHASE HAND EXISTS"}</p>
            </div></> : <div className="session-placeholder"><h2>Workspace prepared.</h2><p>No hand is saved in this session yet. This phase does not deal cards or simulate play. Your wallet, configuration snapshot, session status, and future practice space are ready for Prompt 6.</p></div>}
            <div className="session-table-top"><span>{session.machineSnapshot.coins} coins · {session.machineSnapshot.lines} lines</span><span>{money(session.machineSnapshot.denominationCents)} denomination</span></div>
          </div>
          <div className="panel panel-pad" style={{ marginTop: 16 }}><div className="panel-title"><div><p className="eyebrow">SAVED SESSION TERMS</p><h2>Frozen at start</h2><p>Machine edits do not rewrite an existing session snapshot.</p></div></div>
            <div className="detail-grid"><div className="detail"><label>Paytable</label><strong>{PAY_TABLE_LIBRARY.find(table => table.id === session.machineSnapshot.paytableId)?.name ?? "Saved custom table"}</strong></div><div className="detail"><label>Family</label><strong>{familyName(analysis?.familyId ?? PAY_TABLE_LIBRARY.find(table => table.id === session.machineSnapshot.paytableId)?.familyId ?? "unknown")}</strong></div><div className="detail"><label>Wallet</label><strong>{session.walletId}</strong></div><div className="detail"><label>Started</label><strong>{dateTime(session.startedAt)}</strong></div></div>
          </div>
        </section>
        <aside className="session-side">
          <section className="panel panel-pad"><div className="panel-title"><div><p className="eyebrow">SESSION CONTROL</p><h2>{session.status === "closed" ? "Record closed" : session.status === "paused" ? "Practice paused" : "Ready when you are"}</h2><p>Controls change only this saved session status.</p></div></div>
            <div className="metric-row"><span>Current credits</span><strong>{credits(session.state.credits)} credits</strong></div>
            <div className="metric-row"><span>Wallet balance</span><strong>{money(Math.round(session.state.credits * session.machineSnapshot.denominationCents))}</strong></div>
            <div className="metric-row"><span>Hands in summary</span><strong>{session.summary.hands}</strong></div>
            {active && <div className="backup-actions">{session.status === "active" ? <button className="btn secondary" type="button" disabled={busy} onClick={() => onPause(session)}>Pause</button> : <button className="btn gold" type="button" disabled={busy} onClick={() => onResume(session)}>Resume</button>}<button className="btn danger" type="button" disabled={busy} onClick={() => onClose(session)}>Close session</button></div>}
            {session.status === "closed" && <p className="settings-copy" style={{ marginTop: 12 }}>This session is closed and kept in history. Its saved record remains viewable.</p>}
          </section>
          <section className="panel panel-pad"><div className="panel-title"><div><p className="eyebrow">COMPUTED STRATEGY</p><h2>Engine preparation</h2><p>Lazy-loaded for this session's table only.</p></div></div>
            {analysisLoading ? <><div className="skeleton" style={{ minHeight: 100 }} /><p className="settings-copy" style={{ marginTop: 12 }}>Loading verified analysis in the local worker…</p></> : analysisError ? <div className="error-banner" role="alert">Analysis could not be loaded: {analysisError}<br /><button className="text-button" type="button" onClick={onRetry}>Retry analysis</button></div> : analysis ? <>
              {session.machineSnapshot.coins < 5 && <div className="warning-card">Analysis below is a <strong>5-coin baseline</strong>. It is not the configured {session.machineSnapshot.coins}-coin return.</div>}
              <div className="analysis-stats"><div className="analysis-stat"><span>Computed return</span><strong>{analysis.returnPct.toFixed(3)}%</strong></div><div className="analysis-stat"><span>Variance</span><strong>{analysis.variance.toFixed(3)}</strong></div><div className="analysis-stat"><span>Hit frequency</span><strong>{(analysis.hitFreq * 100).toFixed(2)}%</strong></div><div className="analysis-stat"><span>Baseline bet</span><strong>{analysis.betCoins} coins</strong></div></div>
              <p className="settings-copy" style={{ marginTop: 12 }}>Computed from this paytable via the verified engine. Strategy lists: {analysis.strategyLists.length}. These are analysis facts, not a claim of results for a hand that has not been played.</p>
            </> : <p className="settings-copy">Open session table analysis is unavailable.</p>}
          </section>
        </aside>
      </div>}
    {sessions.length > 0 && session && <section className="panel panel-pad" style={{ marginTop: 20 }}><div className="panel-title"><div><p className="eyebrow">CLOSED HISTORY</p><h2>Saved records</h2><p>View the stored session state without reopening or resetting it.</p></div></div>{sessions.map(item => <div className="list-row" key={item.id}><div className="list-main"><strong>{item.machineSnapshot.name} · {modeName(item.mode)}</strong><span>{dateTime(item.startedAt)} · {item.summary.hands} hands · {item.status}</span></div><button className="text-button" type="button" onClick={() => onSelect(item.id)}>View saved record</button></div>)}</section>}
  </>;
}
