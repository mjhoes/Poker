import { useEffect } from "react";
import { cardRank, cardSuit, describeLabel, formatCard } from "@perfect-draw/engine";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { FeedbackMode, Session } from "@perfect-draw/shared";
import type { AnalysisSummary } from "../worker/engine-api";
import { credits, dateTime, familyName, modeName, money } from "../components/UiHelpers";

const rankLabels = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const suitLabels = ["clubs", "diamonds", "hearts", "spades"];
const suitMarks = ["♣", "♦", "♥", "♠"];
const feedbackModes: { value: FeedbackMode; label: string }[] = [
  { value: "warn_before_draw", label: "Warn before draw" },
  { value: "show_after_draw", label: "Show after draw" },
  { value: "silent_report", label: "Silent report" },
];
const cardName = (card: number) => `${rankLabels[cardRank(card)]} of ${suitLabels[cardSuit(card)]}`;
const gradeLabel = (label: string, familyId: string) => {
  try { return describeLabel(label, familyId as Parameters<typeof describeLabel>[1]); }
  catch { return label; }
};
const formatEv = (value: number) => `${value > 0 && value < 0.001 ? value.toExponential(2) : value.toFixed(3)} coins`;

function PlayingCard({ card, index, held, disabled, completed, onClick }: {
  card: number; index: number; held: boolean; disabled: boolean; completed: boolean; onClick: () => void;
}) {
  const suit = cardSuit(card);
  const rank = rankLabels[cardRank(card)];
  return <button
    type="button"
    data-play-card={index}
    className={`hand-card ${suit === 1 || suit === 2 ? "red-suit" : ""} ${held ? "held" : ""}`}
    disabled={disabled}
    aria-pressed={completed ? undefined : held}
    aria-label={completed ? `${cardName(card)}, final hand card.` : `${cardName(card)}, ${held ? "held" : "not held"}. ${disabled ? "Hold selection unavailable." : "Toggle hold."}`}
    title={`${formatCard(card)} · press ${index + 1} to toggle`}
    onClick={onClick}
  >
    <span className="card-corner">{rank}<br /><span style={{ fontSize: ".78em" }}>{suitMarks[suit]}</span></span>
    <span className="card-suit" aria-hidden="true">{suitMarks[suit]}</span>
    <span className="card-shortcut" aria-hidden="true">{index + 1}</span>
    <span className="hold-caption">{held ? "HELD" : "HOLD"}</span>
  </button>;
}

function DecisionFeedback({ grade, session, warning, onUseBest, onDrawAnyway, busy }: {
  grade: NonNullable<Session["state"]["feedback"]>; session: Session; warning: boolean;
  onUseBest: () => void; onDrawAnyway: () => void; busy: boolean;
}) {
  const familyId = session.state.analysis?.familyId ?? "jacks_or_better";
  const correct = grade.correct;
  const originalHand = session.state.analysis?.hand ?? [];
  const heldCards = (mask: number) => originalHand
    .filter((_, index) => (mask & (1 << index)) !== 0)
    .map(formatCard);
  const heldNames = (mask: number) => originalHand
    .filter((_, index) => (mask & (1 << index)) !== 0)
    .map(cardName);
  const chosenCards = heldCards(grade.chosenMask);
  const bestCards = heldCards(grade.bestMask);
  return <div className={`feedback-panel ${warning ? "is-warning" : correct ? "is-correct" : ""}`} role={warning ? "alert" : "status"}>
    <h3>{warning ? "Hold review" : correct ? "Optimal hold" : "A different hold was stronger"}</h3>
    <p>{warning
      ? "This first decision has been recorded. Change the hold to correct it, or draw anyway to keep the original decision in your session record."
      : correct ? "This selection is engine-optimal. Equivalent holds are recognized as correct."
        : "The engine has graded the saved hold against all available choices. EV is expected return, not a guaranteed result."}</p>
    <div className="feedback-metrics">
      <div className="feedback-metric"><span>Your hold · expected value</span><strong>{formatEv(grade.chosenEv)}</strong></div>
      <div className="feedback-metric"><span>Best hold · expected value</span><strong>{formatEv(grade.bestEv)}</strong></div>
      <div className="feedback-metric"><span>EV lost · per line / all lines</span><strong>{formatEv(grade.evLoss)} / {formatEv(grade.totalEvLoss)}</strong></div>
    </div>
    <p style={{ marginTop: 11 }}><strong>Your hold:</strong> {gradeLabel(grade.chosenLabel, familyId)}<br /><strong>Best hold:</strong> {gradeLabel(grade.bestLabel, familyId)}</p>
    {originalHand.length === 5 && <div className="feedback-hold-detail">
      <p><strong>Original deal:</strong> <span aria-label={originalHand.map(cardName).join(", ")}>{originalHand.map(formatCard).join(" · ")}</span></p>
      <p><strong>Cards held · your choice:</strong> <span aria-label={heldNames(grade.chosenMask).join(", ") || "No cards held"}>{chosenCards.length ? chosenCards.join(" · ") : "None"}</span></p>
      <p><strong>Cards held · best choice:</strong> <span aria-label={heldNames(grade.bestMask).join(", ") || "No cards held"}>{bestCards.length ? bestCards.join(" · ") : "None"}</span></p>
    </div>}
    {warning && <div className="feedback-actions">
      <button className="btn secondary small" type="button" disabled={busy} onClick={onUseBest}>Use best hold</button>
      <button className="btn gold small" type="button" data-play-action="submit" disabled={busy} onClick={onDrawAnyway}>Draw anyway</button>
    </div>}
  </div>;
}

function ClosedSummary({ session }: { session: Session }) {
  const summary = session.summary;
  const familyId = PAY_TABLE_LIBRARY.find(item => item.id === session.machineSnapshot.paytableId)?.familyId ?? "jacks_or_better";
  return <section className="panel panel-pad session-summary">
    <div className="panel-title"><div><p className="eyebrow">CLOSED SESSION REPORT</p><h2>Practice, accounted for.</h2><p>Saved totals from the engine-backed decisions and settled outcomes in this session.</p></div></div>
    <div className="detail-grid">
      <div className="detail"><label>Hands completed</label><strong className="summary-number">{summary.hands}</strong></div>
      <div className="detail"><label>Coin-in</label><strong className="summary-number">{money(summary.coinInCents)}</strong></div>
      <div className="detail"><label>Net</label><strong className={`summary-number ${summary.netCents < 0 ? "negative" : "positive"}`}>{money(summary.netCents)}</strong></div>
      <div className="detail"><label>Decision errors</label><strong className="summary-number">{summary.errors}</strong></div>
      <div className="detail"><label>Error rate</label><strong className="summary-number">{summary.hands ? `${((summary.errors / summary.hands) * 100).toFixed(1)}%` : "—"}</strong></div>
      <div className="detail"><label>EV lost · all lines</label><strong className="summary-number">{formatEv(summary.evLost)}</strong></div>
      <div className="detail"><label>Biggest hit</label><strong className="summary-number">{money(summary.biggestWinCents)}</strong></div>
    </div>
    <div style={{ marginTop: 18 }}>
      <p className="eyebrow">MOST REPEATED MISTAKES</p>
      {summary.topMistakes.length ? summary.topMistakes.map((mistake, index) => {
        const [best, chosen] = mistake.label.split(" → ");
        return <div className="list-row" key={`${mistake.label}-${index}`}>
          <div className="list-main"><strong>{gradeLabel(best ?? mistake.label, familyId)} → {gradeLabel(chosen ?? "", familyId)}</strong><span>{mistake.count} recorded {mistake.count === 1 ? "decision" : "decisions"}</span></div>
        </div>;
      }) : <p className="settings-copy">No suboptimal first decisions were recorded.</p>}
    </div>
  </section>;
}

export function SessionPage({ session, sessions, analysis, analysisError, analysisLoading, busy, playError, onRetryPlay, onPause, onResume, onClose, onSelect, onHold, onSetMask, onDeal, onSubmit, onFeedback, onRetry }: {
  session?: Session; sessions: Session[]; analysis: AnalysisSummary | null; analysisError: string; analysisLoading: boolean; busy: boolean;
  playError: string; onRetryPlay: () => void;
  onPause: (session: Session) => void; onResume: (session: Session) => void; onClose: (session: Session) => void; onSelect: (id: string) => void;
  onHold: (session: Session, index: number) => void; onSetMask: (session: Session, mask: number) => void;
  onDeal: (session: Session) => void; onSubmit: (session: Session, confirmMistake?: boolean) => void;
  onFeedback: (session: Session, mode: FeedbackMode) => void; onRetry: () => void;
}) {
  const active = session?.status === "active";
  const canPlay = !!session && active && !busy;
  const state = session?.state;
  const warning = state?.warning ?? null;
  const showGrade = session?.mode === "drill" || session?.status === "closed" || state?.feedbackMode !== "silent_report";
  const visibleGrade = showGrade ? warning ?? state?.feedback ?? null : null;
  const cardSet = state?.hand ?? [];
  const canToggle = !!session && active && state?.phase === "holding" && !busy;
  const canDeal = !!session && active && (state?.phase === "ready" || state?.phase === "complete" || (state?.phase === "holding" && state.handId === null));
  const canSubmit = !!session && active && state?.phase === "holding" && !!state.handId && !busy;
  const blockedClose = !!session && session.status !== "closed" && session.mode === "free_play" && !!state?.handId && state.phase === "holding";

  useEffect(() => {
    if (!session || session.status !== "active") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.isContentEditable || target.closest("[role='dialog']") || target.closest("input, textarea, select")) return;
      const cardButton = target.closest<HTMLElement>("[data-play-card]");
      const actionButton = target.closest<HTMLElement>("[data-play-action]");
      const interactive = target.closest("button, a");
      if (interactive && !cardButton && !actionButton) return;
      if ((!interactive || cardButton || actionButton) && /^[1-5]$/.test(event.key)) {
        if (!canToggle || cardSet.length !== 5) return;
        event.preventDefault();
        const index = Number(event.key) - 1;
        onHold(session, index);
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        if (actionButton) event.preventDefault();
        else if (interactive && !cardButton) return;
        else event.preventDefault();
        if (busy) return;
        if (state?.phase === "holding") {
          if (state.handId) onSubmit(session, !!(session.mode === "free_play" && warning));
          else if (canDeal) onDeal(session);
        } else if (canDeal) onDeal(session);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, state?.phase, state?.handId, canToggle, canDeal, busy, cardSet.length, onHold, onDeal, onSubmit]);

  return <>
    <div className="page-heading session-room-heading"><div><p className="eyebrow">PRIVATE TRAINING ROOM</p><h1>{session ? session.machineSnapshot.name : "Practice table"}</h1></div><p className="heading-note">{session ? `${modeName(session.mode)} · saved session · ${session.status === "paused" ? "paused" : session.status === "active" ? "active" : "closed"}. ${session.mode === "drill" ? "One hand at a time, with immediate engine feedback and no wager." : "Real engine decisions and settled play-money outcomes."}` : "Choose a saved table to continue a hand or review its closed-session report."}</p></div>
    {!session ? <div className="empty-state"><div className="empty-mark" aria-hidden="true">S</div><h2>No open session</h2><p>Prepare a Free Play table for full hands with play-money settlement, or use Rapid Drill to practice decisions without wagering.</p><a className="btn" href="#/">Browse machine configurations</a>{sessions.length > 0 && <div style={{ marginTop: 24, textAlign: "left" }}><p className="eyebrow">CLOSED SESSION HISTORY</p>{sessions.map(item => <div className="list-row" key={item.id}><div className="list-main"><strong>{item.machineSnapshot.name} · {modeName(item.mode)}</strong><span>{dateTime(item.startedAt)} · {item.summary.hands} hands</span></div><button className="text-button" type="button" onClick={() => onSelect(item.id)}>View saved report</button></div>)}</div>}</div> :
      <div className="session-workspace">
         {session.trainingFocus && <section className="focused-drill-note" aria-label="Focused Rapid Drill">
           <p className="eyebrow">FOCUSED RAPID DRILL</p>
           <h2>Practice this decision</h2>
           <p><strong>{gradeLabel(session.trainingFocus.label, PAY_TABLE_LIBRARY.find(item => item.id === session.machineSnapshot.paytableId)?.familyId ?? "jacks_or_better")}</strong></p>
           <span>Deal a hand to begin. This saved drill keeps its focus across reloads; it is not the future adaptive 70/20/10 trainer.</span>
         </section>}
        <section className="play-console">
          <div className="play-table">
            <div className="play-topline"><span className="play-mode-tag">{modeName(session.mode)}</span><span>{session.status.toUpperCase()} · HAND {state?.handIndex ? String(state.handIndex).padStart(3, "0") : "—"}</span></div>
            {cardSet.length === 5 ? <>
              <div className="hand-cards" role="group" aria-label={state?.phase === "complete" && session.mode === "free_play" ? "First final line outcome." : "Current poker hand. Select cards to hold."}>
                {cardSet.map((card, index) => {
                  const held = state?.phase === "holding" && !!((state.heldMask ?? 0) & (1 << index));
                  return <PlayingCard key={`${card}-${index}`} card={card} index={index} held={held} completed={state?.phase === "complete"} disabled={!canToggle} onClick={() => onHold(session, index)} />;
                })}
              </div>
              <p className="play-instruction">{state?.phase === "holding" ? (session.mode === "drill" ? "Choose the hold you would make. Check your decision for immediate feedback." : "Select every card to keep, then draw to complete the hand.") : state?.phase === "complete" ? "Hand complete. Review the result, then deal the next hand." : "Saved hand. Resume the session to change the hold."}</p>
            </> : <div className="session-placeholder"><h2>{session.status === "active" ? "Table is ready." : "Practice paused."}</h2><p>{session.status === "active" ? session.mode === "drill" ? "Deal a hand to begin a no-wager decision drill." : "Deal when you are ready. The configured play-money bet is recorded before the hand begins." : "Resume this saved session to continue. Its state will be restored exactly as saved."}</p></div>}
            <div className="play-action-row">
              {canDeal && <button className="btn gold" type="button" data-play-action="deal" disabled={!canPlay} onClick={() => onDeal(session)}>{busy ? "Working…" : "Deal hand"}</button>}
              {state?.phase === "holding" && state.handId && session.mode === "free_play" && <button className="btn gold" type="button" data-play-action="submit" disabled={!canSubmit} onClick={() => onSubmit(session)}>{busy ? "Settling…" : "Draw"}</button>}
              {state?.phase === "holding" && state.handId && session.mode === "drill" && <button className="btn gold" type="button" data-play-action="submit" disabled={!canSubmit} onClick={() => onSubmit(session)}>{busy ? "Checking…" : "Check answer"}</button>}
              {state?.phase === "complete" && <span className="session-phase">HAND SAVED · READY FOR NEXT DEAL</span>}
            </div>
            {cardSet.length === 5 && state?.phase === "holding" && <p className="keyboard-hint">1–5 select cards · Space or Enter {session.mode === "drill" ? "checks answer" : "draws"}</p>}
            {state?.phase === "ready" && <p className="keyboard-hint">Space or Enter deals the next hand</p>}
            {state?.phase === "holding" && !state.handId && <p className="status-note">Legacy saved preview: selections remain editable. Deal starts a real engine-backed hand.</p>}
            {warning && visibleGrade && state?.feedbackMode === "warn_before_draw" && <DecisionFeedback grade={warning} session={session} warning onUseBest={() => onSetMask(session, warning.bestMask)} onDrawAnyway={() => onSubmit(session, true)} busy={busy} />}
            {!warning && visibleGrade && state?.phase === "complete" && <DecisionFeedback grade={visibleGrade} session={session} warning={false} onUseBest={() => {}} onDrawAnyway={() => {}} busy={busy} />}
            {state?.phase === "complete" && state.outcome && session.mode === "free_play" && <div className="feedback-panel is-correct" aria-label="Settled line outcomes">
              <h3>Settlement · {money(Math.round(state.outcome.totalPayoutCoins * session.machineSnapshot.denominationCents))}</h3>
              <p>{state.outcome.totalPayoutCoins} coins returned across {state.outcome.lines.length} line{state.outcome.lines.length === 1 ? "" : "s"}.</p>
              <div className="outcome-list">{state.outcome.lines.map((line, index) => <div className="outcome-row" key={index}><span>Line {index + 1} · {line.rank}<br /><small>{line.hand.map(card => formatCard(card)).join(" · ")}</small></span><strong>{line.payoutCoins} coins</strong></div>)}</div>
            </div>}
            {playError && <div className="play-error" role="alert">{playError}<br /><button className="text-button" type="button" onClick={onRetryPlay}>Retry this action</button></div>}
            <div className="play-bottomline" style={{ marginTop: 20 }}><span>{session.machineSnapshot.coins} coins · {session.mode === "drill" ? "1 drill line" : `${session.machineSnapshot.lines} lines`}</span><span>{money(session.machineSnapshot.denominationCents)} denomination · {session.mode === "drill" ? "no wager" : "play money"}</span></div>
          </div>

          {session.status === "closed" && <ClosedSummary session={session} />}
          {session.status !== "closed" && <section className="panel panel-pad">
            <div className="panel-title"><div><p className="eyebrow">FEEDBACK SETTING</p><h2>Choose when to see the grade</h2><p>{session.mode === "drill" ? "Rapid Drill always grades immediately, without betting or paying from your wallet." : "This setting is saved with the session and restored with the hand."}</p></div></div>
            {session.mode === "free_play" ? <div className="mode-switch" role="group" aria-label="Feedback timing">{feedbackModes.map(option => <button className={`btn secondary ${state?.feedbackMode === option.value ? "selected" : ""}`} key={option.value} type="button" aria-pressed={state?.feedbackMode === option.value} disabled={!active || busy} onClick={() => onFeedback(session, option.value)}>{option.label}</button>)}</div> : <p className="settings-copy">Immediate engine feedback is always on for Rapid Drill.</p>}
            {session.mode === "free_play" && state?.feedbackMode === "silent_report" && <p className="status-note">Correctness, EV and optimal-hold guidance are withheld during play. They appear only in the closed-session report.</p>}
          </section>}

          <section className="panel panel-pad">
            <div className="panel-title"><div><p className="eyebrow">SAVED TABLE TERMS</p><h2>Frozen at start</h2><p>Machine edits do not rewrite this session snapshot.</p></div></div>
            <div className="detail-grid"><div className="detail"><label>Paytable</label><strong>{PAY_TABLE_LIBRARY.find(table => table.id === session.machineSnapshot.paytableId)?.name ?? "Saved custom table"}</strong></div><div className="detail"><label>Family</label><strong>{familyName(analysis?.familyId ?? PAY_TABLE_LIBRARY.find(table => table.id === session.machineSnapshot.paytableId)?.familyId ?? "unknown")}</strong></div><div className="detail"><label>Coins / lines</label><strong>{session.machineSnapshot.coins} / {session.machineSnapshot.lines}</strong></div><div className="detail"><label>Denomination</label><strong>{money(session.machineSnapshot.denominationCents)}</strong></div><div className="detail"><label>Wallet</label><strong>{session.walletId}</strong></div><div className="detail"><label>Started</label><strong>{dateTime(session.startedAt)}</strong></div></div>
            <details className="analysis-details" onToggle={event => {
              if (event.currentTarget.open && !analysis && !analysisLoading && !analysisError) onRetry();
            }}>
              <summary>Optional table analysis</summary>
              {analysisLoading ? <><div className="skeleton" style={{ minHeight: 85, marginTop: 12 }} /><p className="settings-copy" style={{ marginTop: 12 }}>Loading local worker analysis. Gameplay remains available.</p></> : analysisError ? <div className="play-error" role="alert">Table analysis unavailable: {analysisError}<br /><button className="text-button" type="button" onClick={onRetry}>Retry analysis</button></div> : analysis ? <>
                {session.machineSnapshot.coins < 5 && <div className="warning-card">Analysis below is a 5-coin baseline, not the configured {session.machineSnapshot.coins}-coin return.</div>}
                <div className="analysis-stats"><div className="analysis-stat"><span>Computed return</span><strong>{analysis.returnPct.toFixed(3)}%</strong></div><div className="analysis-stat"><span>Variance</span><strong>{analysis.variance.toFixed(3)}</strong></div><div className="analysis-stat"><span>Hit frequency</span><strong>{(analysis.hitFreq * 100).toFixed(2)}%</strong></div><div className="analysis-stat"><span>Baseline bet</span><strong>{analysis.betCoins} coins</strong></div></div>
                <p className="settings-copy" style={{ marginTop: 12 }}>Computed through the verified local engine. Strategy lists: {analysis.strategyLists.length}.</p>
              </> : <p className="settings-copy">Optional analysis has not loaded. Play remains available.</p>}
            </details>
          </section>
        </section>
        <aside className="session-side">
          <section className="panel panel-pad"><div className="panel-title"><div><p className="eyebrow">SESSION CONTROL</p><h2>{session.status === "closed" ? "Record closed" : session.status === "paused" ? "Practice paused" : "In the room"}</h2><p>{session.mode === "drill" ? "Drill decisions never touch the wallet." : "Each Free Play wager and payout is saved by the session engine."}</p></div></div>
            <div className="metric-row"><span>Current credits</span><strong>{credits(state?.credits ?? 0)} credits</strong></div>
            <div className="metric-row"><span>Wallet value</span><strong>{money(Math.round((state?.credits ?? 0) * session.machineSnapshot.denominationCents))}</strong></div>
            <div className="metric-row"><span>Hands completed</span><strong>{session.summary.hands}</strong></div>
            {session.status !== "closed" && <div className="metric-row"><span>Coin-in</span><strong>{money(session.summary.coinInCents)}</strong></div>}
            {session.status === "closed" && <><div className="metric-row"><span>Net result</span><strong>{money(session.summary.netCents)}</strong></div><div className="metric-row"><span>Decision errors</span><strong>{session.summary.errors}</strong></div><div className="metric-row"><span>EV lost</span><strong>{formatEv(session.summary.evLost)}</strong></div></>}
            {session.status !== "closed" && <div className="backup-actions">
              {session.status === "active" ? <button className="btn secondary" type="button" disabled={busy} onClick={() => onPause(session)}>Pause</button> : <button className="btn gold" type="button" disabled={busy} onClick={() => onResume(session)}>Resume</button>}
              <button className="btn danger" type="button" disabled={busy || blockedClose} title={blockedClose ? "Finish the paid hand before closing this session." : undefined} onClick={() => onClose(session)}>Close session</button>
            </div>}
            {blockedClose && <p className="status-note">Finish this paid hand before closing. The service will not discard an unsettled wager.</p>}
            {session.status === "closed" && <p className="settings-copy" style={{ marginTop: 12 }}>The saved report remains available in session history.</p>}
          </section>
        </aside>
      </div>}
    {sessions.length > 0 && session && <section className="panel panel-pad" style={{ marginTop: 20 }}><div className="panel-title"><div><p className="eyebrow">CLOSED HISTORY</p><h2>Saved records</h2><p>Open any closed session report without changing its saved state.</p></div></div>{sessions.map(item => <div className="list-row" key={item.id}><div className="list-main"><strong>{item.machineSnapshot.name} · {modeName(item.mode)}</strong><span>{dateTime(item.startedAt)} · {item.summary.hands} hands · {item.status}</span></div><button className="text-button" type="button" onClick={() => onSelect(item.id)}>View saved report</button></div>)}</section>}
  </>;
}
