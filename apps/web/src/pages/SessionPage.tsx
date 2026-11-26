import { useEffect, useState } from "react";
import { PaceChip, PaceMeter } from "../cruise/PaceMeter";
import { TrainingNote } from "../training/TrainingNote";
import type { Run } from "../hooks/useActionRunner";
import { findPaytable } from "../paytables/catalog";
import type { FeedbackMode, Session } from "@perfect-draw/shared";
import type { TableSummary } from "../worker/engine-api";
import { creditLabel, dateTime, familyName, sessionModeName, money, plural } from "../components/UiHelpers";
import type { FeltId } from "../components/Felt";
import { Badge, Button, CoinAmount, Disclosure, Tooltip } from "../components/ui";
import { Icon } from "../components/Icons";
import { useAppStore } from "../state/app-store";
import { CardBack } from "../table/CardFace";
import { PlayingCard } from "../table/PlayingCard";
import { PayTable, shortRankName } from "../table/PayTable";
import { LineRows } from "../table/LineRows";
import { CreditMeter } from "../table/CreditMeter";
import { TableSettings } from "../table/TableSettings";
import { HoldReview, MistakeFeedback, OptimalFeedback, gradeLabel } from "../table/Feedback";
import { winningMask } from "../table/cards";
import { BetControls, currentBet } from "../table/BetControls";
import { fixedBet, handPaytableId } from "../services/bet";

const Ev = ({ value, session }: { value: number; session: Session }) =>
  <CoinAmount amount={value} denominationCents={session.machineSnapshot.denominationCents} digits={3} />;
const creditsValueCents = (session: Session) =>
  Math.round(session.state.credits * session.machineSnapshot.denominationCents) + session.state.creditRemainderCents;
const statusBadge = (session: Session) => <Badge tone={session.status === "active" ? "success" : session.status === "paused" ? "warning" : "neutral"} dot>
  {session.status === "paused" ? "Paused" : session.status === "active" ? "In play" : "Closed"}
</Badge>;

function ClosedSummary({ session }: { session: Session }) {
  const summary = session.summary;
  const familyId = findPaytable(session.machineSnapshot.paytableId)?.familyId ?? "jacks_or_better";
  return <section className="panel panel-pad session-summary">
    <div className="panel-title"><div><p className="eyebrow">SESSION REPORT</p><h2>How this session went</h2></div></div>
    <div className="detail-grid">
      <div className="detail"><label>Hands completed</label><strong className="summary-number">{summary.hands}</strong></div>
      <div className="detail"><label>Coin-in</label><strong className="summary-number">{money(summary.coinInCents)}</strong></div>
      <div className="detail"><label>Net</label><strong className={`summary-number ${summary.netCents < 0 ? "negative" : "positive"}`}>{money(summary.netCents)}</strong></div>
      <div className="detail"><label>Decision errors</label><strong className="summary-number">{summary.errors}</strong></div>
      <div className="detail"><label>Error rate</label><strong className="summary-number">{summary.hands ? `${((summary.errors / summary.hands) * 100).toFixed(1)}%` : "—"}</strong></div>
      <div className="detail"><label>EV lost · all lines</label><strong className="summary-number"><Ev value={summary.evLost} session={session} /></strong></div>
      <div className="detail"><label>Biggest hit</label><strong className="summary-number">{money(summary.biggestWinCents)}</strong></div>
    </div>
    <div style={{ marginTop: 18 }}>
      <p className="eyebrow">MOST REPEATED MISTAKES</p>
      {summary.topMistakes.length ? summary.topMistakes.map((mistake, index) => {
        const [best, chosen] = mistake.label.split(" → ");
        return <div className="list-row" key={`${mistake.label}-${index}`}>
          <div className="list-main"><strong>{gradeLabel(best ?? mistake.label, familyId)} → {gradeLabel(chosen ?? "", familyId)}</strong><span>{plural(mistake.count, "time")}</span></div>
        </div>;
      }) : <p className="settings-copy">No mistakes this session.</p>}
    </div>
  </section>;
}

function SessionHistory({ sessions, onSelect }: { sessions: Session[]; onSelect: (id: string) => void }) {
  return <>{sessions.map(item => <div className="list-row" key={item.id}>
    <div className="list-main"><strong>{item.machineSnapshot.name} · {sessionModeName(item)}</strong><span>{dateTime(item.startedAt)} · {plural(item.summary.hands, "hand")}</span></div>
    <button className="text-button" type="button" onClick={() => onSelect(item.id)}>View report</button>
  </div>)}</>;
}

export function SessionPage({ session, felt, sessions, analysis, analysisError, analysisLoading, busy, run, playError, onRetryPlay, onPause, onResume, onClose, onSelect, onHold, onSetMask, onDeal, onSubmit, onFeedback, onRetry, onBet, onBetMax }: {
  session?: Session; felt: FeltId; sessions: Session[]; analysis: TableSummary | null; analysisError: string; analysisLoading: boolean; busy: boolean; run: Run;
  playError: string; onRetryPlay: () => void;
  onPause: (session: Session) => void; onResume: (session: Session) => void; onClose: (session: Session) => void; onSelect: (id: string) => void;
  onHold: (session: Session, index: number) => void; onSetMask: (session: Session, mask: number) => void;
  onDeal: (session: Session) => void; onSubmit: (session: Session, confirmMistake?: boolean) => void;
  onFeedback: (session: Session, mode: FeedbackMode) => void; onRetry: () => void;
  onBet: (session: Session, coins: number) => void; onBetMax: (session: Session) => void;
}) {
  const active = session?.status === "active";
  const walletName = useAppStore(store => store.wallets.find(wallet => wallet.id === session?.walletId)?.name) ?? "Deleted wallet";
  const dealSpeed = useAppStore(store => store.dealSpeed);
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
  const reviewing = !!warning && !!visibleGrade && state?.feedbackMode === "warn_before_draw";
  const finalGrade = !warning && state?.phase === "complete" ? visibleGrade : null;
  const shownGrade = reviewing ? warning : finalGrade;

  // Details start open after a weaker hold and closed after an optimal one; the player can flip them on any hand.
  const gradeKey = `${session?.id}-${state?.handId}-${state?.phase}-${warning ? "review" : "final"}`;
  const [detailsChoice, setDetailsChoice] = useState<{ key: string; open: boolean } | null>(null);
  const detailsOpen = detailsChoice?.key === gradeKey ? detailsChoice.open : !shownGrade?.correct;
  const toggleDetails = () => setDetailsChoice({ key: gradeKey, open: !detailsOpen });

  useEffect(() => {
    if (!session || session.status !== "active") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if ((event.key === " " || event.key === "Enter") && warning) { event.preventDefault(); return; }
      if (target.isContentEditable || target.closest("[role='dialog']") || target.closest("input, textarea, select")) return;
      const cardButton = target.closest<HTMLElement>("[data-play-card]");
      const actionButton = target.closest<HTMLElement>("[data-play-action]");
      const interactive = target.closest("button, a");
      if (interactive && !cardButton && !actionButton) return;
      if ((!interactive || cardButton || actionButton) && /^[1-5]$/.test(event.key)) {
        if (!canToggle || cardSet.length !== 5) return;
        event.preventDefault();
        onHold(session, Number(event.key) - 1);
        return;
      }
      if ((event.key === "b" || event.key === "m") && canDeal && !busy && fixedBet(session) === null && (!interactive || cardButton || actionButton)) {
        event.preventDefault();
        if (event.key === "m") onBetMax(session);
        else onBet(session, currentBet(session).coins % 5 + 1);
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        if (actionButton) event.preventDefault();
        else if (interactive && !cardButton) return;
        else event.preventDefault();
        if (busy) return;
        if (state?.phase === "holding") {
          if (state.handId) onSubmit(session);
          else if (canDeal) onDeal(session);
        } else if (canDeal) onDeal(session);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, state?.phase, state?.handId, canToggle, canDeal, busy, cardSet.length, onHold, onDeal, onSubmit, onBet, onBetMax, warning]);

  if (!session) return <>
    <div className="page-heading"><div><p className="eyebrow">Session room</p><h1>No table open</h1></div><p className="heading-note">Pick a machine to play, or open a past session's report.</p></div>
    <div className="empty-state"><div className="empty-mark" aria-hidden="true">S</div><h2>No open session</h2><p>Play full hands in Free Play, or practice decisions quickly in Rapid Drill.</p><a className="btn" href="#/">Choose a machine</a>
      {sessions.length > 0 && <div style={{ marginTop: 24, textAlign: "left" }}><p className="eyebrow">PAST SESSIONS</p><SessionHistory sessions={sessions} onSelect={onSelect} /></div>}</div>
  </>;

  const config = session.machineSnapshot;
  const libraryTable = findPaytable(config.paytableId);
  const familyId = state?.analysis?.familyId ?? libraryTable?.familyId ?? "jacks_or_better";
  const freePlay = session.mode === "free_play";
  const complete = state?.phase === "complete";
  const outcome = complete && freePlay ? state?.outcome ?? null : null;
  const mainLine = outcome?.lines[0];
  const mainWinning = mainLine && mainLine.payoutCoins > 0 ? winningMask(mainLine.hand, mainLine.rank, familyId) : 0;
  const hits = new Set(outcome?.lines.filter(line => line.payoutCoins > 0).map(line => line.rank) ?? []);
  const suggestedMask = reviewing && warning ? warning.bestMask : 0;
  const handKey = state?.handId ?? "preview";
  const bet = currentBet(session).coins;

  return <>
    <header className="session-bar">
      <div>
        <p className="eyebrow session-eyebrow">{sessionModeName(session)} {statusBadge(session)}</p>
        <h1>{config.name}</h1>
        <p className="session-bar-meta">{state?.handPaytableId ? `${findPaytable(state.handPaytableId)?.name ?? "Another pay table"} (this hand)` : libraryTable?.name ?? "Custom pay table"} · {money(config.denominationCents)} per coin · bet {plural(bet, "coin")}{freePlay ? ` × ${plural(config.lines, "line")}` : " · no wager"}</p>
      </div>
      {session.status !== "closed" && <div className="session-bar-actions">
        {session.status === "active" ? <Button variant="secondary" icon="pause" disabled={busy} onClick={() => onPause(session)}>Pause</Button> : <Button variant="gold" icon="play" disabled={busy} onClick={() => onResume(session)}>Resume</Button>}
        {blockedClose
          ? <Tooltip text="Finish this hand first. Its bet is already placed." focusable align="end"><Button variant="danger" icon="door" disabled>Close session</Button></Tooltip>
          : <Button variant="danger" icon="door" disabled={busy} onClick={() => onClose(session)}>Close session</Button>}
      </div>}
    </header>

    <div className="session-workspace">
      {session.training && <TrainingNote session={session} busy={busy} run={run} />}
      {session.trainingFocus && <section className="focused-drill-note" aria-label="Focused Rapid Drill">
        <p className="eyebrow">FOCUSED RAPID DRILL</p>
        <h2>Practice this decision</h2>
        <p><strong>{gradeLabel(session.trainingFocus.label, familyId)}</strong></p>
        <span>Every hand dealt in this drill tests this decision.</span>
      </section>}

      <section className="play-console">
        <div className="play-table" data-felt={felt} data-speed={dealSpeed}>
          <div className="play-topline">
            <span className="play-mode-tag">{sessionModeName(session)}</span>
            {session.pace && <PaceChip session={session} />}
            <span className="hand-counter">Hand {state?.handIndex ? String(state.handIndex).padStart(3, "0") : "—"}</span>
            {session.status !== "closed" && <TableSettings session={session} busy={busy} onFeedback={mode => onFeedback(session, mode)} />}
          </div>

          <PayTable paytableId={handPaytableId(session)} coins={bet} hits={hits} />
          <LineRows session={session} familyId={familyId} />

          <div className="hand-zone">
            {cardSet.length === 5 ? <>
              <div className="hand-cards" role="group" aria-label={complete && freePlay ? "First final line outcome." : "Current poker hand. Select cards to hold."}>
                {cardSet.map((card, index) => {
                  const bit = 1 << index;
                  const held = state?.phase === "holding" && !!((state.heldMask ?? 0) & bit);
                  return <PlayingCard key={`${handKey}-${index}-${card}`} card={card} index={index} held={held} completed={complete}
                    disabled={!canToggle} winning={!!(mainWinning & bit)} dimmed={!!mainWinning && !(mainWinning & bit)}
                    suggested={!!(suggestedMask & bit)} onClick={() => onHold(session, index)} />;
                })}
              </div>
              {mainLine && mainLine.payoutCoins > 0 && <div className="hand-banner" role="status">
                {config.lines > 1 ? "Line 1 · " : ""}{shortRankName(mainLine.rank)} · <CoinAmount amount={mainLine.payoutCoins} denominationCents={config.denominationCents} />
              </div>}
              {finalGrade?.correct && <div className="optimal-stamp" aria-hidden="true"><Icon name="check" size={18} />Optimal</div>}
            </> : <>
              <div className="hand-cards is-empty" aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <span key={index} className="hand-card-slot"><CardBack /></span>)}</div>
              <div className="placeholder-caption">
                <h2>{session.status === "active" ? "Ready when you are." : session.status === "paused" ? "Session paused." : "Session closed."}</h2>
                <p>{session.status === "active" ? freePlay ? `Each deal bets ${plural(bet * config.lines, "credit")} (${money(bet * config.lines * config.denominationCents)}).` : "Deal a hand to start drilling." : session.status === "paused" ? "Resume to pick up exactly where you left off." : "This session's report is below."}</p>
              </div>
            </>}
          </div>

          {state?.phase === "holding" && cardSet.length === 5 && !reviewing && <p className="play-instruction">{session.status !== "active" ? "Resume the session to continue this hand." : freePlay ? "Tap the cards to keep, then draw." : "Tap the cards you'd keep, then check your answer."}</p>}

          {reviewing && warning ? <HoldReview grade={warning} session={session} busy={busy} open={detailsOpen} onToggle={toggleDetails}
            onUseBest={() => onSetMask(session, warning.bestMask)} onDrawAnyway={() => onSubmit(session, true)} /> : <div className="play-action-row">
            {canDeal && <>
              {fixedBet(session) === null && <><Button variant="secondary" className="bet-button" disabled={!canPlay} onClick={() => onBet(session, bet % 5 + 1)} title="Add one credit per line (B)">Bet One</Button>
              <Button variant="secondary" className="bet-button" disabled={!canPlay} onClick={() => onBetMax(session)} title="Bet 5 credits per line and deal (M)">Bet Max</Button></>}
              <Button variant="gold" icon="cards" data-play-action="deal" disabled={!canPlay} loading={busy} loadingLabel="Dealing…" onClick={() => onDeal(session)}>Deal hand</Button>
            </>}
            {state?.phase === "holding" && state.handId && freePlay && <Button variant="gold" icon="draw" data-play-action="submit" disabled={!canSubmit} loading={busy} loadingLabel="Drawing…" onClick={() => onSubmit(session)}>Draw</Button>}
            {state?.phase === "holding" && state.handId && !freePlay && <Button variant="gold" icon="check" data-play-action="submit" disabled={!canSubmit} loading={busy} loadingLabel="Checking…" onClick={() => onSubmit(session)}>Check answer</Button>}
          </div>}
          {active && !reviewing && cardSet.length === 5 && state?.phase === "holding" && <p className="keyboard-hint">1–5 hold cards · Space or Enter {freePlay ? "draws" : "checks"}</p>}
          {active && (state?.phase === "ready" || complete) && <p className="keyboard-hint">Space or Enter deals · B bet one · M bet max</p>}
          {state?.phase === "holding" && !state.handId && <p className="status-note">This is a saved preview hand. Deal to start a real hand.</p>}

          {finalGrade && (finalGrade.correct
            ? <OptimalFeedback grade={finalGrade} session={session} open={detailsOpen} onToggle={toggleDetails} />
            : <MistakeFeedback grade={finalGrade} session={session} open={detailsOpen} onToggle={toggleDetails} />)}
          {playError && <div className="play-error" role="alert">{playError}<br /><button className="text-button" type="button" onClick={onRetryPlay}>Retry this action</button></div>}

          {session.status !== "closed" && <BetControls session={session} busy={busy} onBet={coins => onBet(session, coins)} />}
          <CreditMeter session={session} betCoins={bet} />
        </div>

        {session.status === "closed" && <ClosedSummary session={session} />}
      </section>

      <aside className="session-side">
        {session.pace && <PaceMeter session={session} />}
        <section className="panel panel-pad session-stats">
          <p className="eyebrow">This session</p>
          <div className="metric-row"><span>Credits</span><strong className="coin-amount"><span className="coin-amount-credits">{creditLabel(state ?? { credits: 0 })}</span><span className="coin-amount-dollars">({money(creditsValueCents(session))})</span></strong></div>
          <div className="metric-row"><span>Hands played</span><strong>{session.summary.hands}</strong></div>
          {freePlay && <div className="metric-row"><span>Coin-in</span><strong>{money(session.summary.coinInCents)}</strong></div>}
          {freePlay && session.summary.hands > 0 && <div className="metric-row"><span>Net</span><strong className={session.summary.netCents < 0 ? "negative" : "positive"}>{money(session.summary.netCents)}</strong></div>}
          {showGrade && <div className="metric-row"><span>Mistakes</span><strong>{session.summary.errors}</strong></div>}
          {showGrade && <div className="metric-row"><span>EV lost</span><strong><Ev value={session.summary.evLost} session={session} /></strong></div>}
          {!showGrade && <p className="status-note" style={{ marginTop: 10 }}>Grades are hidden until you close the session.</p>}
        </section>
        <section className="panel panel-pad session-info">
          <Disclosure summary="Table details">
            <div className="detail-grid">
              <div className="detail"><label>Pay table</label><strong>{libraryTable?.name ?? "Custom pay table"}</strong></div>
              <div className="detail"><label>Game</label><strong>{familyName(analysis?.familyId ?? familyId)}</strong></div>
              <div className="detail"><label>Default bet × lines</label><strong>{config.coins} × {freePlay ? config.lines : 1}</strong></div>
              <div className="detail"><label>Denomination</label><strong>{money(config.denominationCents)}</strong></div>
              <div className="detail"><label>Wallet</label><strong>{walletName}</strong></div>
              <div className="detail"><label>Started</label><strong>{dateTime(session.startedAt)}</strong></div>
            </div>
            <p className="disclosure-note">Set when the session started. Editing the machine later doesn't change them.</p>
          </Disclosure>
          <Disclosure summary="Optional table analysis" onToggle={open => {
            if (open && !analysis && !analysisLoading && !analysisError) onRetry();
          }}>
            {analysisLoading ? <><div className="skeleton" style={{ minHeight: 85, marginTop: 12 }} /><p className="settings-copy" style={{ marginTop: 12 }}>Computing the exact figures for a {plural(bet, "coin")} bet. This takes a few seconds once; you can keep playing.</p></> : analysisError ? <div className="play-error" role="alert" style={{ marginTop: 12 }}>Table analysis unavailable: {analysisError}<br /><button className="text-button" type="button" onClick={onRetry}>Retry analysis</button></div> : analysis ? <>
              <div className="analysis-stats"><div className="analysis-stat"><span>Computed return</span><strong>{analysis.returnPct.toFixed(3)}%</strong></div><div className="analysis-stat"><span>Variance</span><strong>{analysis.variance.toFixed(3)}</strong></div><div className="analysis-stat"><span>Hit frequency</span><strong>{(analysis.hitFreq * 100).toFixed(2)}%</strong></div><div className="analysis-stat"><span>Bet</span><strong>{plural(analysis.betCoins, "coin")}</strong></div></div>
              <p className="disclosure-note">Exact, with perfect play at this bet. Computed by the engine on this device.</p>
            </> : <p className="settings-copy">Analysis hasn't loaded yet.</p>}
          </Disclosure>
        </section>
      </aside>
    </div>
    {sessions.length > 0 && <section className="panel panel-pad" style={{ marginTop: 20 }}><div className="panel-title"><div><p className="eyebrow">PAST SESSIONS</p><h2>Session history</h2></div></div><SessionHistory sessions={sessions} onSelect={onSelect} /></section>}
  </>;
}
