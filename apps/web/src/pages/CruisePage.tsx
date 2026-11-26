import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Machine, Session, Wallet } from "@perfect-draw/shared";
import { Badge, Button, MenuButton } from "../components/ui";
import { money } from "../components/UiHelpers";
import type { ConfirmOptions } from "../components/ConfirmDialog";
import type { Run } from "../hooks/useActionRunner";
import { useAllPaytables } from "../paytables/catalog";
import { denominationLabel } from "../machines/machine-info";
import { casinoService, rewardService, tripService } from "../services/cruise";
import {
  activeMs, betCents, DEFAULT_HANDS_PER_HOUR, hoursLeft, plannedHours, pointsEarned, rewardsSummary, rollup, sessionCoinIn,
  sessionStatus, toCsv, tripPhase,
} from "../cruise/economics";
import type { CasinoSession, Program, Rollup, Trip } from "../cruise/economics";
import { returnKey, useCruiseData, useExpectedReturns, useNow, usePaceBands, usePracticePace } from "../cruise/useCruise";
import { CashOutDialog, formatDuration, PAUSE_LABELS, PauseDialog, ProgramDialog, ReadingDialog, REWARD_TYPES, RewardDialog, StartCasinoDialog, TripDialog } from "../cruise/CruiseDialogs";
import { Planner } from "../cruise/Planner";
import { PaceDialog, PacePanel } from "../cruise/PaceTraining";
import type { TripNeed } from "../cruise/PaceTraining";
import { bestPace, DEFAULT_ACCURACY_PCT } from "../cruise/pace";

type Dialog =
  | { kind: "trip"; trip?: Trip } | { kind: "program"; program: Program } | { kind: "start"; trip: Trip }
  | { kind: "pause" | "cash" | "points" | "cashout"; session: CasinoSession } | { kind: "reward"; tripId?: string } | { kind: "pace" };

const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${money(Math.abs(cents))}`;
const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const perPoint = (cents: number | null) => cents === null ? "—" : `${cents < 0 ? "−" : ""}${money(Math.abs(cents))}`;
const shortDate = (at: number) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);
const tripDates = (trip: Trip) => {
  const format = (date: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  return `${format(trip.sailStart)} – ${format(trip.sailEnd)}`;
};
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** The trip to show first: one at sea now, else the next one, else the latest. */
function defaultTrip(trips: Trip[], now: number) {
  return trips.find(trip => tripPhase(trip, now) === "active") ?? [...trips].filter(trip => tripPhase(trip, now) === "planned").sort((a, b) => a.sailStart.localeCompare(b.sailStart))[0] ?? trips[0];
}

function ProgressRing({ value, target }: { value: number; target: number }) {
  const share = target > 0 ? Math.min(1, value / target) : 0;
  const radius = 52, circumference = 2 * Math.PI * radius;
  return <div className="progress-ring" role="img" aria-label={`${number(Math.floor(value))} of ${number(target)} points`}>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle className="ring-track" cx="60" cy="60" r={radius} />
      {share > 0 && <circle className="ring-value" cx="60" cy="60" r={radius} strokeDasharray={`${share * circumference} ${circumference}`} transform="rotate(-90 60 60)" />}
    </svg>
    <div className="ring-label"><strong>{number(Math.floor(value))}</strong><span>of {number(target)}</span></div>
  </div>;
}
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="cruise-stat"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function LivePanel({ session, trip, program, now, busy, onDialog, onResume }: {
  session: CasinoSession; trip?: Trip; program: Program; now: number; busy: boolean;
  onDialog: (kind: "pause" | "cash" | "points" | "cashout") => void; onResume: () => void;
}) {
  const status = sessionStatus(session);
  const played = activeMs(session, now);
  const coinIn = sessionCoinIn(session, program);
  const last = session.timeSegments[session.timeSegments.length - 1];
  return <section className={`panel live-panel ${status}`} aria-label="Casino session">
    <div className="live-head">
      <div><p className="eyebrow">{status === "playing" ? "PLAYING" : "PAUSED"} · {trip?.shipName ?? "Trip"}</p>
        <h2>{session.gameName || "Casino session"} <span className="muted">· {denominationLabel(session.denominationCents)} × {session.coins} = {money(betCents(session))} a hand</span></h2></div>
      {status === "paused" && last.pauseReason && <Badge tone="warning" dot>{PAUSE_LABELS[last.pauseReason]}</Badge>}
    </div>
    <div className="live-body">
      <div className="live-timer" role="timer" aria-label={`Active play time ${formatDuration(played)}`}>{formatDuration(played, true)}</div>
      <dl className="live-facts">
        <div><dt>Cash in</dt><dd>{money(session.cashInCents)}</dd></div>
        <div><dt>Points</dt><dd>{session.pointsBefore === undefined ? "Not read" : session.pointsAfter === undefined ? number(session.pointsBefore) : `${number(session.pointsBefore)} → ${number(session.pointsAfter)} (+${number(session.pointsAfter - session.pointsBefore)})`}</dd></div>
        <div><dt>Coin-in so far</dt><dd>{coinIn.source === "points" ? money(coinIn.cents) : "From points at cash-out"}</dd></div>
        {session.jackpots.length > 0 && <div><dt>Hand pays</dt><dd>{session.jackpots.map(jackpot => money(jackpot.amountCents)).join(", ")}</dd></div>}
      </dl>
    </div>
    <div className="live-actions">
      {status === "playing" ? <Button variant="secondary" icon="pause" disabled={busy} onClick={() => onDialog("pause")}>Pause</Button>
        : <Button variant="gold" icon="play" disabled={busy} onClick={onResume}>Resume</Button>}
      <Button variant="secondary" icon="plus" disabled={busy} onClick={() => onDialog("cash")}>Add cash</Button>
      <Button variant="secondary" icon="edit" disabled={busy} onClick={() => onDialog("points")}>{session.pointsBefore === undefined ? "Starting points" : "Points now"}</Button>
      <Button icon="door" disabled={busy} onClick={() => onDialog("cashout")}>Cash out</Button>
    </div>
  </section>;
}

function SessionsTable({ sessions, program, points, onEdit, onDelete }: {
  sessions: CasinoSession[]; program: Program; points: ReadonlyMap<string, number>; onEdit: (session: CasinoSession) => void; onDelete: (session: CasinoSession) => void;
}) {
  const closed = sessions.filter(session => session.endedAt !== null).reverse();
  if (!closed.length) return null;
  return <section className="panel panel-pad cruise-panel" aria-labelledby="sessions-title">
    <div className="panel-title"><div><p className="eyebrow">CASINO SESSIONS · {closed.length}</p><h2 id="sessions-title">What each session cost</h2></div></div>
    <div className="table-scroll"><table className="ledger cruise-table">
      <thead><tr><th>Started</th><th>Game</th><th>Time</th><th>Coin-in</th><th>Points</th><th>Net</th><th>Per point</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
      <tbody>{closed.map(session => {
        const coinIn = sessionCoinIn(session, program), earned = points.get(session.id) ?? 0, net = session.cashOutCents - session.cashInCents;
        return <tr key={session.id}>
          <td>{shortDate(session.startedAt)}</td>
          <td>{session.gameName || "—"}<small className="cell-note">{denominationLabel(session.denominationCents)} × {session.coins}</small></td>
          <td>{formatDuration(session.activeMs)}</td>
          <td>{money(coinIn.cents)}<small className="cell-note">{coinIn.source === "points" ? "from points" : coinIn.source === "hands" ? "from hands" : "estimated"}</small></td>
          <td>{number(earned, Number.isInteger(earned) ? 0 : 1)}</td>
          <td className={net < 0 ? "negative" : "positive"}>{signed(net)}</td>
          <td>{earned > 0 ? perPoint(-net / earned) : "—"}</td>
          <td><MenuButton label={`Actions for the session of ${shortDate(session.startedAt)}`} items={[
            { label: "Correct readings", icon: "edit", onSelect: () => onEdit(session) },
            { label: "Delete session", icon: "trash", tone: "danger", onSelect: () => onDelete(session) },
          ]} /></td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}

function Totals({ rolled, title, eyebrow, extra, returnsState }: { rolled: Rollup; title: string; eyebrow: string; extra?: ReactNode; returnsState: "loading" | "failed" | "ok" }) {
  const estimated = rolled.coinInBySource.estimate > 0;
  const loadingReturns = returnsState === "loading";
  const theoryNote = loadingReturns ? "Working out the games' returns…"
    : returnsState === "failed" ? "A game's return couldn't be worked out, so its play isn't counted. Reload to try again."
    : rolled.coinInWithoutReturnCents > 0 ? `${money(rolled.coinInWithoutReturnCents)} of coin-in on games without a pay table isn't counted`
    : rolled.unmeasuredSessions ? "At perfect play where practice doesn't yet measure your mistakes"
    : rolled.estimatedSessions ? "Your mistakes estimated where practice doesn't cover every kind of deal" : "What skill controls";
  return <section className="panel panel-pad cruise-panel" aria-label={title}>
    <div className="panel-title"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div>
    {rolled.sessions > 0 && <div className="cruise-stats">
      <Stat label="Points earned" value={number(rolled.points, Number.isInteger(rolled.points) ? 0 : 1)} />
      <Stat label="Coin-in" value={money(rolled.coinInCents)} note={estimated ? `${money(rolled.coinInBySource.estimate)} estimated` : undefined} />
      <Stat label="Net result" value={signed(rolled.netCents)} />
      <Stat label="Cost per point" value={perPoint(rolled.actualCostPerPointCents)} note="What happened (mostly luck)" />
      <Stat label="Theoretical cost per point" value={loadingReturns ? "…" : perPoint(rolled.theoreticalCostPerPointCents)} note={theoryNote} />
      <Stat label="Your mistakes cost" value={loadingReturns ? "…" : money(rolled.mistakeCostCents)} note={!loadingReturns && rolled.points > 0 ? `${perPoint(rolled.mistakeCostCents / rolled.points)} a point` : undefined} />
      <Stat label="Active play" value={formatDuration(rolled.activeMs)} />
      <Stat label="Points per hour" value={rolled.pointsPerHour === null ? "—" : number(rolled.pointsPerHour, 1)} note={rolled.handsPerHour === null ? "After 10 minutes of play" : `${number(rolled.handsPerHour)} hands/hr`} />
    </div>}
    {extra}
  </section>;
}

export function CruisePage({ machines, wallets, practiceSessions, busy, run, confirm, onOpenRoom }: {
  machines: Machine[]; wallets: Wallet[]; practiceSessions: Session[]; busy: boolean; run: Run;
  confirm: (options: ConfirmOptions) => Promise<boolean>; onOpenRoom: () => void;
}) {
  const data = useCruiseData();
  const bands = usePaceBands();
  // The accuracy bar and feedback start from your last pace session (99.9% and quiet the first time).
  const lastPace = [...practiceSessions].filter(session => session.pace).sort((a, b) => b.startedAt - a.startedAt)[0];
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const accuracyPct = accuracy ?? lastPace?.pace?.accuracyPct ?? DEFAULT_ACCURACY_PCT;
  const tables = useAllPaytables();
  const practicePace = usePracticePace();
  const [tripId, setTripId] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const live = data.sessions.find(session => session.endedAt === null);
  const now = useNow(!!live && sessionStatus(live) === "playing");
  const trip = data.trips.find(item => item.id === tripId) ?? defaultTrip(data.trips, now);
  useEffect(() => { if (trip && trip.id !== tripId) setTripId(trip.id); }, [trip, tripId]);

  const program = data.programs.find(item => item.id === trip?.programId) ?? data.programs[0];
  const programSessions = useMemo(() => {
    const ids = new Set(data.trips.filter(item => item.programId === program?.id).map(item => item.id));
    return data.sessions.filter(session => ids.has(session.tripId));
  }, [data.trips, data.sessions, program?.id]);
  const points = useMemo(() => program ? pointsEarned(programSessions, program) : new Map<string, number>(), [programSessions, program]);
  const returns = useExpectedReturns(data.sessions);
  const returnFor = (session: CasinoSession) => returns.get(returnKey(session.paytableId, session.coins)) ?? null;
  const returnsState = (rows: CasinoSession[]) => !rows.some(session => session.paytableId) ? "ok" as const : !returns.ready ? "loading" as const
    : rows.some(session => session.paytableId && !returns.get(returnKey(session.paytableId, session.coins))) ? "failed" as const : "ok" as const;

  if (!data.ready) return <div className="skeleton" />;
  if (!program) return <div className="error-banner" role="alert">The rewards program couldn't be loaded. {data.error}</div>;

  const tripSessions = trip ? programSessions.filter(session => session.tripId === trip.id) : [];
  const tripRolled = rollup(tripSessions, program, points, returnFor, now);
  const lifetime = rollup(programSessions, program, points, returnFor, now);
  const rewards = data.rewards.filter(reward => reward.programId === program.id);
  const rewardTotals = rewardsSummary(rewards, lifetime);
  // Pace: from casino sessions with a points reading or a hand count, else Free Play, else typical.
  const measured = rollup(programSessions.filter(session => session.endedAt !== null && sessionCoinIn(session, program).source !== "estimate"), program, points, () => null);
  const casinoPace = measured.activeMs >= 30 * 60_000 ? measured.handsPerHour : null;
  const pace = casinoPace ?? practicePace ?? DEFAULT_HANDS_PER_HOUR;
  const lastSession = [...data.sessions].reverse().find(session => session.endedAt !== null) ?? data.sessions[data.sessions.length - 1];
  const pointsSoFar = (trip?.startingPoints ?? 0) + tripRolled.points;
  const tripHoursLeft = trip && tripPhase(trip, now) !== "done" ? hoursLeft(trip, tripSessions, now) : 0;
  const need: TripNeed | null = trip ? {
    pointsNeeded: Math.max(0, Math.ceil(trip.targetPoints - pointsSoFar)), hoursLeft: tripHoursLeft, dollarsPerPoint: program.dollarsPerPoint,
    betCents: lastSession ? betCents(lastSession) : 125,
  } : null;
  const best = bands ? bestPace(bands, accuracyPct) : null;
  const pacePanel = <PacePanel bands={bands} program={program} need={need} accuracyPct={accuracyPct} onAccuracy={setAccuracy} onTrain={() => setDialog({ kind: "pace" })} />;

  async function deleteTrip(value: Trip) {
    if (!await confirm({ title: `Delete “${value.shipName}”?`, tone: "danger", icon: "trash", confirmLabel: "Delete trip",
      body: <p>Its casino sessions and the rewards recorded for it are deleted too.</p> })) return;
    await run(async () => { await tripService.remove(value.id); setTripId(""); }, { success: "Trip deleted." });
  }
  async function deleteSession(value: CasinoSession) {
    if (!await confirm({ title: "Delete this casino session?", tone: "danger", icon: "trash", confirmLabel: "Delete session",
      body: <p>Its cash, points and time are removed from the trip's totals.</p> })) return;
    await run(() => casinoService.remove(value.id), { success: "Session deleted." });
  }
  async function deleteReward(id: string) {
    await run(() => rewardService.remove(id), { success: "Reward removed." });
  }
  function exportSessions() {
    const tripName = new Map(data.trips.map(item => [item.id, item.shipName]));
    download(`perfect-draw-casino-sessions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      ["Trip", "Started", "Ended", "Game", "Denomination", "Coins", "Active minutes", "Cash in", "Cash out", "Net", "Free play used",
        "Points before", "Points after", "Hands", "Coin-in", "Coin-in from", "Points earned", "Notes"],
      ...programSessions.filter(session => session.endedAt !== null).map(session => {
        const coinIn = sessionCoinIn(session, program);
        return [tripName.get(session.tripId), new Date(session.startedAt).toISOString(), new Date(session.endedAt!).toISOString(), session.gameName,
          (session.denominationCents / 100).toFixed(2), session.coins, Math.round(session.activeMs / 60_000), (session.cashInCents / 100).toFixed(2),
          (session.cashOutCents / 100).toFixed(2), ((session.cashOutCents - session.cashInCents) / 100).toFixed(2), (session.freePlayUsedCents / 100).toFixed(2),
          session.pointsBefore, session.pointsAfter, session.handsCount, (coinIn.cents / 100).toFixed(2), coinIn.source, points.get(session.id) ?? 0, session.notes];
      }),
    ]));
  }
  function exportRewards() {
    const tripName = new Map(data.trips.map(item => [item.id, item.shipName]));
    download(`perfect-draw-rewards-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      ["Received", "Reward", "Type", "Value", "Trip", "Notes"],
      ...rewards.map(reward => [new Date(reward.receivedAt).toISOString().slice(0, 10), reward.description, REWARD_TYPES[reward.type], (reward.valueCents / 100).toFixed(2), tripName.get(reward.tripId ?? ""), reward.notes]),
    ]));
  }

  const liveTrip = live ? data.trips.find(item => item.id === live.tripId) : undefined;
  const phase = trip ? tripPhase(trip, now) : "planned";
  return <>
    <div className="page-heading"><div><p className="eyebrow">CRUISE REWARDS</p><h1>What each point costs you.</h1></div>
      <p className="heading-note">Real-play records you enter yourself. Playing better lowers the cost of a point; playing faster saves hours.</p></div>
    {data.error && <div className="error-banner" role="alert">{data.error}</div>}

    {live && program && <LivePanel session={live} trip={liveTrip} program={program} now={now} busy={busy}
      onDialog={kind => setDialog({ kind, session: live })} onResume={() => void run(() => casinoService.resume(live.id))} />}

    {!trip ? <div className="empty-state cruise-empty">
      <div className="empty-mark" aria-hidden="true">⚓</div>
      <h2>Plan your next cruise</h2>
      <p>Set a points target and the casino hours you expect each day. While you play, a timer and two point readings give you coin-in, points and what each point really cost.</p>
      <p className="muted">{program.name}: 1 point per {money(program.dollarsPerPoint * 100)} of coin-in{program.freePlayEarnsPoints ? "" : "; free play earns none"}.</p>
      <div className="panel-actions"><Button variant="gold" icon="plus" onClick={() => setDialog({ kind: "trip" })}>Plan a trip</Button>
        <Button variant="secondary" icon="settings" onClick={() => setDialog({ kind: "program", program })}>Program rules</Button></div>
    </div> : null}
    {!trip && pacePanel}
    {trip && <>
      <div className="trip-bar">
        <label className="field trip-picker"><span className="field-label">Trip</span>
          <select aria-label="Trip" value={trip.id} onChange={event => setTripId(event.target.value)}>
            {data.trips.map(item => <option key={item.id} value={item.id}>{item.shipName} · {tripDates(item)}</option>)}
          </select></label>
        <Badge tone={phase === "active" ? "success" : phase === "planned" ? "neutral" : "warning"} dot>{phase === "active" ? "At sea" : phase === "planned" ? "Upcoming" : "Done"}</Badge>
        <div className="trip-bar-actions">
          {!live && <Button variant="gold" icon="play" disabled={busy} onClick={() => setDialog({ kind: "start", trip })}>Start casino session</Button>}
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setDialog({ kind: "trip" })}>New trip</Button>
          <MenuButton label="Trip actions" items={[
            { label: "Edit trip and days", icon: "edit", onSelect: () => setDialog({ kind: "trip", trip }) },
            { label: "Program rules", icon: "settings", onSelect: () => setDialog({ kind: "program", program }) },
            { label: "Delete trip", icon: "trash", tone: "danger", disabled: live?.tripId === trip.id, onSelect: () => void deleteTrip(trip) },
          ]} />
        </div>
      </div>

      <section className="panel panel-pad trip-dashboard" aria-label="Trip progress">
        <ProgressRing value={pointsSoFar} target={trip.targetPoints} />
        <div className="trip-summary">
          <p className="eyebrow">{trip.shipName.toUpperCase()} · {tripDates(trip).toUpperCase()}</p>
          <h2>{pointsSoFar >= trip.targetPoints ? "Target reached." : `${number(Math.ceil(trip.targetPoints - pointsSoFar))} points to go.`}</h2>
          <p className="muted">{trip.startingPoints ? `${number(trip.startingPoints)} on your card at the start + ` : ""}{number(tripRolled.points, Number.isInteger(tripRolled.points) ? 0 : 1)} earned on this trip.
            {" "}{formatDuration(tripRolled.activeMs)} played of {number(plannedHours(trip), 1)} h planned; {number(hoursLeft(trip, tripSessions, now), 1)} h left.</p>
          {program.tiers.length > 0 && <p className="tier-note">{program.tiers.map(tier => <span key={tier.name} className={pointsSoFar >= tier.points ? "tier-done" : ""}>{tier.name} {number(tier.points)}</span>)}</p>}
        </div>
      </section>

      {tripSessions.length > 0 && <Totals rolled={tripRolled} eyebrow="THIS TRIP" title="Cost of a point" returnsState={returnsState(tripSessions)} />}

      {/* Inputs follow the trip until changed; switching trips starts afresh. */}
      <Planner key={trip.id} program={program} tables={tables} machines={machines} defaults={{
        targetPoints: trip.targetPoints, pointsSoFar, hoursLeft: tripHoursLeft, bestPace: best?.meanHandsPerHour ?? null, accuracyPct,
        handsPerHour: pace, paceSource: casinoPace ? "casino" : practicePace ? "practice" : "default",
        paytableId: lastSession?.paytableId ?? machines[0]?.paytableId, denominationCents: lastSession?.denominationCents ?? 25, coins: lastSession?.coins ?? 5,
      }} />

      {pacePanel}

      <SessionsTable sessions={tripSessions} program={program} points={points} onEdit={session => setDialog({ kind: "cashout", session })} onDelete={session => void deleteSession(session)} />
    </>}

    {data.trips.length > 0 && <Totals rolled={lifetime} eyebrow="ALL TRIPS" title="Lifetime" returnsState={returnsState(programSessions)} extra={<>
      <div className="rewards-head"><h3>Rewards received</h3><div className="panel-actions">
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setDialog({ kind: "reward", tripId: trip?.id })}>Add reward</Button>
        <Button variant="secondary" size="sm" icon="download" onClick={exportSessions}>Sessions CSV</Button>
        <Button variant="secondary" size="sm" icon="download" disabled={!rewards.length} onClick={exportRewards}>Rewards CSV</Button>
      </div></div>
      {rewards.length ? <>
        <ul className="reward-list">{rewards.map(reward => <li key={reward.id}>
          <span><strong>{reward.description}</strong><small>{REWARD_TYPES[reward.type]} · {new Date(reward.receivedAt).toLocaleDateString()}{reward.tripId ? ` · ${data.trips.find(item => item.id === reward.tripId)?.shipName ?? ""}` : ""}</small></span>
          <span className="reward-value">{money(reward.valueCents)}</span>
          <Button variant="secondary" size="sm" aria-label={`Remove ${reward.description}`} onClick={() => void deleteReward(reward.id)}>Remove</Button>
        </li>)}</ul>
        <div className="cruise-stats">
          <Stat label="Rewards value" value={money(rewardTotals.valueCents)} note={rewardTotals.valuePerPointCents === null ? undefined : `${perPoint(rewardTotals.valuePerPointCents)} a point`} />
          <Stat label="Cost per point after rewards" value={perPoint(rewardTotals.netCostPerPointCents)} />
          <Stat label="Return on losses" value={rewardTotals.roiPct === null ? "—" : `${rewardTotals.roiPct >= 0 ? "+" : ""}${number(rewardTotals.roiPct)}%`} note="(Rewards − net loss) ÷ net loss" />
        </div>
      </> : <p className="status-note">Record offers and comps at what they're worth to you, to see what a point cost once they're counted.</p>}
    </>} />}

    {dialog?.kind === "trip" && <TripDialog trip={dialog.trip} programs={data.programs} busy={busy} run={run} onClose={close} onSaved={setTripId} />}
    {dialog?.kind === "program" && <ProgramDialog program={dialog.program} busy={busy} run={run} onClose={close} />}
    {dialog?.kind === "start" && <StartCasinoDialog trip={dialog.trip} machines={machines} tables={tables} last={lastSession} busy={busy} run={run} onClose={close} />}
    {dialog?.kind === "pause" && <PauseDialog session={dialog.session} busy={busy} run={run} onClose={close} />}
    {(dialog?.kind === "cash" || dialog?.kind === "points") && <ReadingDialog session={dialog.session} kind={dialog.kind} busy={busy} run={run} onClose={close} />}
    {dialog?.kind === "cashout" && <CashOutDialog session={dialog.session} program={program} pace={pace} busy={busy} run={run} onClose={close} />}
    {dialog?.kind === "pace" && <PaceDialog machines={machines} wallets={wallets} program={program} tripId={trip?.id} accuracyPct={accuracyPct}
      need={need && need.pointsNeeded > 0 && need.hoursLeft > 0 ? need : null} feedbackMode={lastPace?.state.feedbackMode ?? "silent_report"}
      fallbackPace={Math.round(best?.meanHandsPerHour ?? pace)} busy={busy} run={run} onClose={close} onStarted={() => { close(); onOpenRoom(); }} />}
    {dialog?.kind === "reward" && <RewardDialog programs={data.programs} trips={data.trips} tripId={dialog.tripId} busy={busy} run={run} onClose={close} />}
  </>;
}
