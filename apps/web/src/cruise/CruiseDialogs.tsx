import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Machine } from "@perfect-draw/shared";
import type { pauseReasons } from "@perfect-draw/shared";
import { Field, Modal, money } from "../components/UiHelpers";
import { ChoiceChips } from "../components/ui";
import { parseCents } from "../services/money";
import { casinoService, programService, rewardService, tripService } from "../services/cruise";
import type { Run } from "../hooks/useActionRunner";
import type { PaytableInfo } from "../paytables/catalog";
import { denominationLabel } from "../machines/machine-info";
import { activeMs, DEFAULT_HOURS, estimateFor, localDate, sessionCoinIn, tripDays } from "./economics";
import type { CasinoSession, Program, Reward, Trip } from "./economics";

type DialogProps = { busy: boolean; run: Run; onClose: () => void };

function Actions({ busy, label, busyLabel, disabled, onClose }: { busy: boolean; label: string; busyLabel: string; disabled?: boolean; onClose: () => void }) {
  return <div className="form-actions"><button className="btn secondary" type="button" onClick={onClose}>Cancel</button><button className="btn" type="submit" disabled={busy || disabled}>{busy ? busyLabel : label}</button></div>;
}
/** Whole points; commas allowed. Empty → undefined, invalid → null. */
export function parsePoints(text: string): number | undefined | null {
  const trimmed = text.trim().replace(/,/g, "");
  if (!trimmed) return undefined;
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : null;
}
/** Dollars → cents; empty → undefined, invalid → null. */
function optionalCents(text: string): number | undefined | null {
  return text.trim() === "" ? undefined : parseCents(text, true);
}
const dollars = (cents: number | undefined) => cents === undefined ? "" : (cents / 100).toFixed(2);
const pointsText = (value: number | undefined) => value === undefined ? "" : String(value);
export const PAUSE_LABELS: Record<typeof pauseReasons[number], string> = {
  drink: "Drink", break: "Break", hand_pay: "Hand pay", machine_fault: "Machine fault", other: "Other",
};
export const REWARD_TYPES: Record<Reward["type"], string> = {
  cruise: "Free cruise", upgrade: "Cabin upgrade", freeplay: "Free play", obc: "Onboard credit", discount: "Discount", other: "Other",
};
const dayLabel = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function TripDialog({ trip, programs, busy, run, onClose, onSaved }: DialogProps & { trip?: Trip; programs: Program[]; onSaved: (id: string) => void }) {
  const today = localDate();
  const [ship, setShip] = useState(trip?.shipName ?? "");
  const [programId, setProgramId] = useState(trip?.programId ?? programs[0]?.id ?? "");
  const [start, setStart] = useState(trip?.sailStart ?? today);
  const [end, setEnd] = useState(trip?.sailEnd ?? today);
  const [target, setTarget] = useState(trip ? String(trip.targetPoints) : "2500");
  const [starting, setStarting] = useState(pointsText(trip?.startingPoints));
  const [notes, setNotes] = useState(trip?.notes ?? "");
  const [planned, setPlanned] = useState<Trip["days"]>(trip?.days ?? []);
  const [error, setError] = useState("");
  const datesValid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
  const days = useMemo(() => datesValid ? tripDays(start, end, planned) : [], [datesValid, start, end, planned]);
  const setDay = (date: string, change: Partial<Trip["days"][number]>) =>
    setPlanned(days.map(day => day.date === date ? { ...day, ...change, ...(change.type ? { casinoHoursPlanned: DEFAULT_HOURS[change.type] } : {}) } : day));
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const targetPoints = parsePoints(target), startingPoints = parsePoints(starting);
    if (!datesValid) { setError("The trip must end on or after the day it starts."); return; }
    if (targetPoints === undefined || targetPoints === null) { setError("Enter a target in whole points."); return; }
    if (startingPoints === null) { setError("Enter starting points as a whole number, or leave it empty."); return; }
    await run(async () => {
      const saved = await tripService.save({ programId, shipName: ship, sailStart: start, sailEnd: end, days, targetPoints, startingPoints, notes }, trip?.id);
      onSaved(saved.id); onClose();
    }, { success: trip ? "Trip saved." : "Trip planned.", onError: setError });
  }
  const total = days.reduce((sum, day) => sum + day.casinoHoursPlanned, 0);
  return <Modal error={error} title={trip ? "Edit trip" : "Plan a trip"} subtitle="Casino hours decide whether the target is reachable. Casinos usually close in port." onClose={onClose} className="trip-dialog">
    <form onSubmit={event => void save(event)}>
      <div className="form-grid">
        <Field label="Ship or trip name"><input aria-label="Ship or trip name" required maxLength={100} value={ship} onChange={event => setShip(event.target.value)} placeholder="e.g. Wonder of the Seas" /></Field>
        {programs.length > 1 && <Field label="Rewards program"><select aria-label="Rewards program" value={programId} onChange={event => setProgramId(event.target.value)}>{programs.map(program => <option key={program.id} value={program.id}>{program.name}</option>)}</select></Field>}
        <Field label="Sails"><input aria-label="Sail date" type="date" required value={start} onChange={event => setStart(event.target.value)} /></Field>
        <Field label="Returns"><input aria-label="Return date" type="date" required value={end} min={start} onChange={event => setEnd(event.target.value)} /></Field>
        <Field label="Target points"><input aria-label="Target points" inputMode="numeric" required value={target} onChange={event => setTarget(event.target.value)} /></Field>
        <Field label="Points on your card now (optional)"><input aria-label="Starting points" inputMode="numeric" value={starting} onChange={event => setStarting(event.target.value)} placeholder="0" /></Field>
      </div>
      <p className="form-hint">The target counts the points on your card: points now plus what you earn on this trip.</p>
      {days.length > 0 && <fieldset className="trip-days">
        <legend>Casino hours by day · {total.toLocaleString(undefined, { maximumFractionDigits: 1 })} h planned</legend>
        {days.map(day => <div key={day.date} className="trip-day">
          <span>{dayLabel(day.date)}</span>
          <select aria-label={`${dayLabel(day.date)} day type`} value={day.type} onChange={event => setDay(day.date, { type: event.target.value as "sea" | "port" })}><option value="sea">Sea day</option><option value="port">Port day</option></select>
          <input aria-label={`${dayLabel(day.date)} casino hours`} type="number" min={0} max={24} step={0.5} value={day.casinoHoursPlanned}
            onChange={event => setDay(day.date, { casinoHoursPlanned: Math.min(24, Math.max(0, Number(event.target.value) || 0)) })} /><span className="muted">h</span>
        </div>)}
      </fieldset>}
      <Field label="Notes" full><textarea aria-label="Trip notes" rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
      <Actions busy={busy} label={trip ? "Save trip" : "Plan trip"} busyLabel="Saving…" onClose={onClose} />
    </form>
  </Modal>;
}

export function ProgramDialog({ program, busy, run, onClose }: DialogProps & { program: Program }) {
  const [name, setName] = useState(program.name);
  const [casino, setCasino] = useState(program.casinoName);
  const [rate, setRate] = useState(String(program.dollarsPerPoint));
  const [rounding, setRounding] = useState(program.rounding);
  const [freePlay, setFreePlay] = useState(program.freePlayEarnsPoints);
  const [tiers, setTiers] = useState(program.tiers.map(tier => ({ name: tier.name, points: String(tier.points) })));
  const [notes, setNotes] = useState(program.notes);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const dollarsPerPoint = Number(rate);
    if (!(dollarsPerPoint > 0) || dollarsPerPoint > 10000) { setError("Enter the coin-in per point in dollars, e.g. 15."); return; }
    const parsed = tiers.filter(tier => tier.name.trim() || tier.points.trim()).map(tier => ({ name: tier.name.trim(), points: parsePoints(tier.points) }));
    if (parsed.some(tier => !tier.name || tier.points === undefined || tier.points === null)) { setError("Give each tier a name and whole points."); return; }
    await run(async () => {
      await programService.save({ name, casinoName: casino, dollarsPerPoint, rounding, freePlayEarnsPoints: freePlay, tiers: parsed as { name: string; points: number }[], notes }, program.id);
      onClose();
    }, { success: "Program saved. Costs and points were recalculated.", onError: setError });
  }
  return <Modal error={error} title="Rewards program" subtitle="Casinos change their rules without notice. Everything here is editable." onClose={onClose}>
    <form onSubmit={event => void save(event)}>
      <div className="form-grid">
        <Field label="Program"><input aria-label="Program name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
        <Field label="Casino"><input aria-label="Casino name" maxLength={100} value={casino} onChange={event => setCasino(event.target.value)} /></Field>
        <Field label="Coin-in per point (USD)"><input aria-label="Coin-in per point" inputMode="decimal" required value={rate} onChange={event => setRate(event.target.value)} /></Field>
        <Field label="Partial points"><select aria-label="Partial points" value={rounding} onChange={event => setRounding(event.target.value as Program["rounding"])}>
          <option value="carryover">Carry over between sessions</option><option value="session_floor">Lost at the end of each session</option><option value="fractional">Counted as fractions</option>
        </select></Field>
      </div>
      <label className="check-row"><input type="checkbox" checked={freePlay} onChange={event => setFreePlay(event.target.checked)} /> Free play earns points</label>
      <fieldset className="tier-list"><legend>Tiers</legend>
        {tiers.map((tier, index) => <div key={index} className="tier-row">
          <input aria-label={`Tier ${index + 1} name`} value={tier.name} maxLength={100} onChange={event => setTiers(tiers.map((item, at) => at === index ? { ...item, name: event.target.value } : item))} placeholder="Name" />
          <input aria-label={`Tier ${index + 1} points`} inputMode="numeric" value={tier.points} onChange={event => setTiers(tiers.map((item, at) => at === index ? { ...item, points: event.target.value } : item))} placeholder="Points" />
          <button type="button" className="btn secondary small" aria-label={`Remove tier ${index + 1}`} onClick={() => setTiers(tiers.filter((_, at) => at !== index))}>Remove</button>
        </div>)}
        {tiers.length < 20 && <button type="button" className="btn secondary small" onClick={() => setTiers([...tiers, { name: "", points: "" }])}>Add tier</button>}
      </fieldset>
      <Field label="Notes" full><textarea aria-label="Program notes" rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
      <Actions busy={busy} label="Save program" busyLabel="Saving…" onClose={onClose} />
    </form>
  </Modal>;
}

const DENOMINATIONS = [5, 25, 100, 500] as const;
export function StartCasinoDialog({ trip, machines, tables, last, busy, run, onClose }: DialogProps & {
  trip: Trip; machines: Machine[]; tables: PaytableInfo[]; last?: CasinoSession;
}) {
  const [game, setGame] = useState(() => last?.machineId && machines.some(machine => machine.id === last.machineId) ? `machine:${last.machineId}`
    : last?.paytableId ? `table:${last.paytableId}` : machines[0] ? `machine:${machines[0].id}` : tables[0] ? `table:${tables[0].id}` : "other");
  const machine = game.startsWith("machine:") ? machines.find(item => `machine:${item.id}` === game) : undefined;
  const [denomination, setDenomination] = useState(dollars(last?.denominationCents ?? machine?.denominationCents ?? 25));
  const [coins, setCoins] = useState(last?.coins ?? machine?.coins ?? 5);
  const [otherName, setOtherName] = useState("");
  const [cashIn, setCashIn] = useState("");
  const [pointsNow, setPointsNow] = useState("");
  const [error, setError] = useState("");
  function choose(value: string) {
    setGame(value);
    const chosen = machines.find(item => `machine:${item.id}` === value);
    if (chosen) { setDenomination(dollars(chosen.denominationCents)); setCoins(chosen.coins); }
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    setError("");
    const denominationCents = parseCents(denomination);
    const cash = optionalCents(cashIn), points = parsePoints(pointsNow);
    if (!denominationCents || denominationCents > 100000) { setError("Enter the denomination in dollars, e.g. 0.25."); return; }
    if (cash === null) { setError("Enter the cash in dollars, e.g. 300."); return; }
    if (points === null) { setError("Enter points as a whole number, or leave it empty."); return; }
    const table = machine ? tables.find(item => item.id === machine.paytableId) : tables.find(item => `table:${item.id}` === game);
    const gameName = machine ? machine.name : table ? table.name : otherName.trim();
    if (game === "other" && !gameName) { setError("Name the game."); return; }
    await run(async () => {
      await casinoService.start({
        tripId: trip.id, machineId: machine?.id, paytableId: table?.id, familyId: table?.familyId, gameName,
        denominationCents, coins, lines: machine?.lines ?? 1, cashInCents: cash ?? 0, pointsBefore: points,
      });
      onClose();
    }, { success: "Timer started.", onError: setError });
  }
  return <Modal error={error} title="Start a casino session" subtitle={trip.shipName} onClose={onClose}>
    <form onSubmit={event => void start(event)}>
      <div className="form-grid">
        <Field label="Game" full><select aria-label="Game" value={game} onChange={event => choose(event.target.value)}>
          {machines.length > 0 && <optgroup label="Your machines">{machines.map(item => <option key={item.id} value={`machine:${item.id}`}>{item.name}</option>)}</optgroup>}
          <optgroup label="Pay tables">{tables.map(table => <option key={table.id} value={`table:${table.id}`}>{table.name}</option>)}</optgroup>
          <option value="other">Another game (no pay table)</option>
        </select></Field>
        {game === "other" && <Field label="Game name" full><input aria-label="Game name" maxLength={200} value={otherName} onChange={event => setOtherName(event.target.value)} placeholder="e.g. Ultimate X Double Double" /></Field>}
        <Field label="Denomination (USD)"><input aria-label="Denomination" inputMode="decimal" required value={denomination} onChange={event => setDenomination(event.target.value)} /></Field>
        <Field label="Coins"><select aria-label="Coins" value={coins} onChange={event => setCoins(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></Field>
        <Field label="Cash in (USD)"><input aria-label="Cash in" inputMode="decimal" value={cashIn} onChange={event => setCashIn(event.target.value)} placeholder="300.00" /></Field>
        <Field label="Points on the machine now"><input aria-label="Points on the machine now" inputMode="numeric" value={pointsNow} onChange={event => setPointsNow(event.target.value)} placeholder="Optional" /></Field>
      </div>
      <ChoiceChips label="Common denominations" value={String(parseCents(denomination) ?? "")} onChange={value => setDenomination(dollars(Number(value)))}
        choices={DENOMINATIONS.map(cents => ({ value: String(cents), label: denominationLabel(cents) }))} />
      <p className="form-hint">With the points now and the points at cash-out, coin-in is worked out for you (each point is $15 of coin-in).</p>
      <Actions busy={busy} label="Start timer" busyLabel="Starting…" onClose={onClose} />
    </form>
  </Modal>;
}

export function PauseDialog({ session, busy, run, onClose }: DialogProps & { session: CasinoSession }) {
  const [reason, setReason] = useState<typeof pauseReasons[number]>("break");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  async function pause(event: FormEvent) {
    event.preventDefault();
    const cents = reason === "hand_pay" ? optionalCents(amount) : undefined;
    if (cents === null) { setError("Enter the hand pay in dollars, or leave it empty."); return; }
    await run(async () => { await casinoService.pause(session.id, reason, cents); onClose(); }, { onError: setError });
  }
  return <Modal error={error} title="Pause the timer" subtitle="Paused time isn't counted as play." onClose={onClose}>
    <form onSubmit={event => void pause(event)}>
      <ChoiceChips label="Why" value={reason} onChange={setReason} choices={(Object.keys(PAUSE_LABELS) as (keyof typeof PAUSE_LABELS)[]).map(value => ({ value, label: PAUSE_LABELS[value] }))} />
      {reason === "hand_pay" && <Field label="Hand pay amount (USD, optional)"><input aria-label="Hand pay amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="1,200.00" /></Field>}
      <Actions busy={busy} label="Pause" busyLabel="Pausing…" onClose={onClose} />
    </form>
  </Modal>;
}

/** One number for a live session: more cash, or the points the machine shows now. */
export function ReadingDialog({ session, kind, busy, run, onClose }: DialogProps & { session: CasinoSession; kind: "cash" | "points" }) {
  const [value, setValue] = useState(kind === "points" ? pointsText(session.pointsAfter ?? session.pointsBefore) : "");
  const [error, setError] = useState("");
  const needsStart = kind === "points" && session.pointsBefore === undefined;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (kind === "cash") {
      const cents = parseCents(value);
      if (!cents) { setError("Enter an amount greater than $0.00."); return; }
      await run(async () => { await casinoService.addCash(session.id, cents); onClose(); }, { success: `${money(cents)} added.`, onError: setError });
      return;
    }
    const points = parsePoints(value);
    if (points === undefined || points === null) { setError("Enter the points as a whole number."); return; }
    await run(async () => {
      if (needsStart) await casinoService.setStartingPoints(session.id, points); else await casinoService.pointsNow(session.id, points);
      onClose();
    }, { onError: setError });
  }
  const title = kind === "cash" ? "Add cash" : needsStart ? "Points when you started" : "Points now";
  return <Modal error={error} title={title} onClose={onClose}>
    <form onSubmit={event => void save(event)}>
      <Field label={kind === "cash" ? "Amount (USD)" : "Points on the machine"}>
        <input aria-label={kind === "cash" ? "Cash amount" : "Points on the machine"} inputMode={kind === "cash" ? "decimal" : "numeric"} required value={value} onChange={event => setValue(event.target.value)} data-autofocus />
      </Field>
      {needsStart && <p className="form-hint">The machine's point count when you sat down. Enter the current count once you've started.</p>}
      <Actions busy={busy} label="Save" busyLabel="Saving…" onClose={onClose} />
    </form>
  </Modal>;
}

function Preview({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="cashout-preview">{rows.map(([label, value]) => <div key={label} className="metric-row"><dt>{label}</dt><dd><strong>{value}</strong></dd></div>)}</dl>;
}
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${money(Math.abs(cents))}`;

/** Cash out (live session) or correct the readings of a closed one. */
export function CashOutDialog({ session, program, pace, busy, run, onClose }: DialogProps & { session: CasinoSession; program: Program; pace: number }) {
  const editing = session.endedAt !== null;
  const [cashIn, setCashIn] = useState(dollars(session.cashInCents));
  const [cashOut, setCashOut] = useState(editing ? dollars(session.cashOutCents) : "");
  const [pointsBefore, setPointsBefore] = useState(pointsText(session.pointsBefore));
  const [pointsAfter, setPointsAfter] = useState(pointsText(session.pointsAfter));
  const [freePlay, setFreePlay] = useState(session.freePlayUsedCents ? dollars(session.freePlayUsedCents) : "");
  const [hands, setHands] = useState(pointsText(session.handsCount));
  const [notes, setNotes] = useState(session.notes);
  const [error, setError] = useState("");
  const now = Date.now();
  const values = {
    cashIn: parseCents(cashIn, true), cashOut: optionalCents(cashOut), before: parsePoints(pointsBefore), after: parsePoints(pointsAfter),
    freePlay: optionalCents(freePlay), hands: parsePoints(hands),
  };
  const valid = values.cashIn !== null && values.cashOut !== null && values.cashOut !== undefined && values.before !== null && values.after !== null && values.freePlay !== null && values.hands !== null;
  const played = activeMs(session, now);
  const preview = valid ? (() => {
    const draft: CasinoSession = {
      ...session, endedAt: session.endedAt ?? now, cashInCents: values.cashIn!, cashOutCents: values.cashOut!, pointsBefore: values.before ?? undefined,
      pointsAfter: values.after ?? undefined, freePlayUsedCents: values.freePlay ?? 0, handsCount: values.hands ?? undefined,
      // Same rule as the service: a closed estimate is kept, anything else is worked out from the time played.
      coinInCents: estimateFor(session, played, pace),
    };
    const coinIn = sessionCoinIn(draft, program);
    const earned = coinIn.source === "points" ? draft.pointsAfter! - draft.pointsBefore! : coinIn.cents / (program.dollarsPerPoint * 100);
    const net = draft.cashOutCents - draft.cashInCents;
    return { coinIn, earned, net };
  })() : null;
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!valid) { setError("Check the amounts: dollars like 250.00, points and hands as whole numbers."); return; }
    if (values.before !== undefined && values.after !== undefined && values.after! < values.before!) { setError("Points at cash-out can't be lower than when you started."); return; }
    await run(async () => {
      if (editing) {
        await casinoService.edit(session.id, {
          cashInCents: values.cashIn!, cashOutCents: values.cashOut!, pointsBefore: values.before ?? undefined, pointsAfter: values.after ?? undefined,
          freePlayUsedCents: values.freePlay ?? 0, handsCount: values.hands ?? undefined, notes, estimateHandsPerHour: pace,
        });
      } else {
        if (values.cashIn !== session.cashInCents) await casinoService.addCash(session.id, values.cashIn! - session.cashInCents).catch(() => { throw new Error("Cash in can only go up while playing; correct it after cashing out."); });
        if (values.before !== undefined && values.before !== session.pointsBefore) await casinoService.setStartingPoints(session.id, values.before!);
        await casinoService.close(session.id, {
          pointsAfter: values.after ?? undefined, cashOutCents: values.cashOut!, freePlayUsedCents: values.freePlay ?? 0,
          handsCount: values.hands ?? undefined, notes, estimateHandsPerHour: pace,
        });
      }
      onClose();
    }, { success: editing ? "Session corrected." : "Cashed out.", onError: setError });
  }
  const sourceNote = preview?.coinIn.source === "points" ? `from points (within ${money(preview.coinIn.withinCents)})` : preview?.coinIn.source === "hands" ? "from hands × bet" : `estimated from ${Math.round(pace)} hands/hr`;
  return <Modal error={error} title={editing ? "Correct this session" : "Cash out"} subtitle={`${session.gameName || "Game"} · ${denominationLabel(session.denominationCents)} × ${session.coins}`} onClose={onClose}>
    <form onSubmit={event => void save(event)}>
      <div className="form-grid">
        <Field label="Cash in (USD)"><input aria-label="Cash in" inputMode="decimal" required value={cashIn} onChange={event => setCashIn(event.target.value)} /></Field>
        <Field label="Cash out (USD)"><input aria-label="Cash out amount" inputMode="decimal" required value={cashOut} onChange={event => setCashOut(event.target.value)} placeholder="0.00" data-autofocus /></Field>
        <Field label="Points when you started"><input aria-label="Points when you started" inputMode="numeric" value={pointsBefore} onChange={event => setPointsBefore(event.target.value)} placeholder="Optional" /></Field>
        <Field label="Points at cash-out"><input aria-label="Points at cash-out" inputMode="numeric" value={pointsAfter} onChange={event => setPointsAfter(event.target.value)} placeholder="Optional" /></Field>
        <Field label="Free play used (USD)"><input aria-label="Free play used" inputMode="decimal" value={freePlay} onChange={event => setFreePlay(event.target.value)} placeholder="0.00" /></Field>
        <Field label="Hands played (if known)"><input aria-label="Hands played" inputMode="numeric" value={hands} onChange={event => setHands(event.target.value)} placeholder="Optional" /></Field>
      </div>
      <Field label="Notes" full><textarea aria-label="Session notes" rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
      {preview && <Preview rows={[
        ["Coin-in", <>{money(preview.coinIn.cents)} <span className="muted">{sourceNote}</span></>],
        ["Points earned", preview.coinIn.source === "points" ? preview.earned.toLocaleString() : `about ${Math.floor(preview.earned).toLocaleString()}`],
        ["Net result", signed(preview.net)],
        ["Cost per point", preview.earned > 0 ? money(-preview.net / preview.earned) : "—"],
        ["Active time", formatDuration(played)],
      ]} />}
      <Actions busy={busy} label={editing ? "Save" : "Cash out"} busyLabel="Saving…" onClose={onClose} />
    </form>
  </Modal>;
}

export function RewardDialog({ programs, trips, tripId, busy, run, onClose }: DialogProps & { programs: Program[]; trips: Trip[]; tripId?: string }) {
  const [description, setDescription] = useState("");
  const [type, setType] = useState<Reward["type"]>("cruise");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(localDate());
  const [trip, setTrip] = useState(tripId ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  async function add(event: FormEvent) {
    event.preventDefault();
    setError("");
    const cents = parseCents(value, true);
    if (cents === null) { setError("Enter what it's worth to you in dollars, e.g. 1500."); return; }
    const programId = trips.find(item => item.id === trip)?.programId ?? programs[0]?.id;
    await run(async () => {
      await rewardService.add({ programId, tripId: trip || undefined, description, type, valueCents: cents, receivedAt: new Date(`${date}T12:00:00`).getTime(), notes });
      onClose();
    }, { success: "Reward added.", onError: setError });
  }
  return <Modal error={error} title="Add a reward" subtitle="An offer or comp, at what it's worth to you in cash." onClose={onClose}>
    <form onSubmit={event => void add(event)}>
      <div className="form-grid">
        <Field label="What" full><input aria-label="Reward" required maxLength={200} value={description} onChange={event => setDescription(event.target.value)} placeholder="e.g. 7-night balcony cruise" /></Field>
        <Field label="Type"><select aria-label="Reward type" value={type} onChange={event => setType(event.target.value as Reward["type"])}>{(Object.keys(REWARD_TYPES) as Reward["type"][]).map(key => <option key={key} value={key}>{REWARD_TYPES[key]}</option>)}</select></Field>
        <Field label="Cash value (USD)"><input aria-label="Cash value" inputMode="decimal" required value={value} onChange={event => setValue(event.target.value)} placeholder="1500.00" /></Field>
        <Field label="Received"><input aria-label="Date received" type="date" required value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="From trip"><select aria-label="From trip" value={trip} onChange={event => setTrip(event.target.value)}><option value="">Not from one trip</option>{trips.map(item => <option key={item.id} value={item.id}>{item.shipName}</option>)}</select></Field>
      </div>
      <Field label="Notes" full><textarea aria-label="Reward notes" rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
      <Actions busy={busy} label="Add reward" busyLabel="Adding…" onClose={onClose} />
    </form>
  </Modal>;
}

export function formatDuration(ms: number, seconds = false) {
  const total = Math.floor(ms / 1000), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  if (seconds) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
