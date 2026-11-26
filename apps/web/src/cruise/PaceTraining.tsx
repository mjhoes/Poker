import { useState } from "react";
import type { FormEvent } from "react";
import type { FeedbackMode, Machine, Wallet } from "@perfect-draw/shared";
import { Badge, Button, ChoiceChips } from "../components/ui";
import { Field, Modal, money } from "../components/UiHelpers";
import type { Run } from "../hooks/useActionRunner";
import { sessionService } from "../services/sessions";
import { betCents } from "./economics";
import type { Program } from "./economics";
import { ACCURACY_CHOICES, bestPace, MIN_BAND_HANDS, mistakeCostPerPointCents, neededPace } from "./pace";
import type { PaceBand } from "./pace";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const hoursText = (hours: number) => !Number.isFinite(hours) ? "—" : hours < 10 ? `${number(hours, 1)} h` : `${number(hours)} h`;
const bandLabel = (band: PaceBand) => band.to === null ? `${number(band.from)}+` : band.from === 0 ? `Under ${number(band.to)}` : `${number(band.from)}–${number(band.to)}`;
export const FEEDBACK_CHOICES: { value: FeedbackMode; label: string; note: string }[] = [
  { value: "silent_report", label: "Quiet", note: "Mistakes in the report at the end, like a real machine." },
  { value: "show_after_draw", label: "After each draw", note: "See each mistake once the hand is over." },
  { value: "warn_before_draw", label: "Before the draw", note: "Stops you to check a weaker hold. Slows your pace." },
];
const accuracyLabel = (value: number) => `${value}%`;

/** What the trip still needs, for working out the pace and hours. */
export type TripNeed = { pointsNeeded: number; hoursLeft: number; dollarsPerPoint: number; betCents: number };

/**
 * The speed/accuracy trade-off from your Free Play hands, grouped by the pace they were played at, with your best
 * pace at the chosen accuracy bar and the hours each pace would take for this trip's remaining target.
 */
export function PacePanel({ bands, withheld, program, need, accuracyPct, onAccuracy, onTrain }: {
  bands: PaceBand[] | null; withheld: number; program: Program; need: TripNeed | null; accuracyPct: number;
  onAccuracy: (value: number) => void; onTrain: () => void;
}) {
  const played = (bands ?? []).filter(band => band.hands > 0);
  const best = bands ? bestPace(bands, accuracyPct) : null;
  const hoursAt = (band: PaceBand) => need && band.meanHandsPerHour ? need.pointsNeeded * need.dollarsPerPoint * 100 / need.betCents / band.meanHandsPerHour : null;
  // The spec's sentence: the fastest pace you play (with enough hands) against your best accurate one.
  const fastest = [...played].reverse().find(band => band.hands >= MIN_BAND_HANDS);
  const compare = best && fastest && fastest.from > best.from ? fastest : null;
  const hoursSaved = compare && hoursAt(best!) !== null && hoursAt(compare) !== null ? hoursAt(best!)! - hoursAt(compare)! : null;
  return <section className="panel panel-pad cruise-panel pace-panel" aria-labelledby="pace-title">
    <div className="panel-title"><div><p className="eyebrow">CASINO PACE</p><h2 id="pace-title">Speed against mistakes</h2>
      <p>Your Free Play hands grouped by how fast you played them. Faster play saves casino hours; mistakes raise the cost of a point.</p></div>
      <Button variant="gold" icon="play" onClick={onTrain}>Train your pace</Button></div>
    <div className="pace-bar-choice"><span className="field-label">Accuracy bar (EV kept)</span>
      <ChoiceChips label="Accuracy bar" value={String(accuracyPct)} onChange={value => onAccuracy(Number(value))}
        choices={ACCURACY_CHOICES.map(value => ({ value: String(value), label: accuracyLabel(value) }))} /></div>
    {withheld > 0 && <p className="status-note pace-withheld">{number(withheld)} {withheld === 1 ? "hand" : "hands"} from an open session with quiet feedback {withheld === 1 ? "joins" : "join"} these figures when you close it, so its accuracy stays hidden until then.</p>}
    {!bands ? <p className="status-note">Reading your hands…</p> : !played.length ? <p className="status-note">Play Free Play or a pace session; your hands will be grouped by speed here.</p> : <>
      <p className="pace-summary">
        {best ? <>Your best pace keeping {accuracyLabel(accuracyPct)}: <strong>about {number(best.meanHandsPerHour ?? 0)} hands/hr</strong>.</>
          : <>None of your speeds keeps {accuracyLabel(accuracyPct)} over {MIN_BAND_HANDS}+ hands yet.</>}
        {compare && compare.errorCostPct !== null && <> At about {number(compare.meanHandsPerHour ?? 0)} hands/hr your mistakes cost {number(compare.errorCostPct, 2)}% of return, adding {money(mistakeCostPerPointCents(program.dollarsPerPoint, compare.errorCostPct - (best!.errorCostPct ?? 0)))} a point{hoursSaved !== null && hoursSaved > 0 ? `, but save ${hoursText(hoursSaved)} on this trip` : ""}.</>}
      </p>
      <div className="table-scroll"><table className="ledger pace-table">
        <thead><tr><th>Hands/hr</th><th>Hands</th><th>EV kept</th><th>Mistakes cost</th><th>Per point</th>{need && <th>Hours to target</th>}</tr></thead>
        <tbody>{played.map(band => {
          const meets = band.evKeptPct !== null && band.evKeptPct + 1e-9 >= accuracyPct;
          const hours = hoursAt(band);
          return <tr key={band.from} className={band === best ? "is-best" : undefined}>
            <td>{bandLabel(band)}{band === best && <> <Badge tone="success">Best</Badge></>}</td>
            <td>{number(band.hands)}{band.hands < MIN_BAND_HANDS && <small className="cell-note">few hands</small>}</td>
            <td className={meets ? "positive" : "negative"}>{band.evKeptPct === null ? "—" : `${number(band.evKeptPct, 2)}%`}</td>
            <td>{band.errorCostPct === null ? "—" : `${number(band.errorCostPct, 2)}% of return`}</td>
            <td>{band.errorCostPct === null ? "—" : money(mistakeCostPerPointCents(program.dollarsPerPoint, band.errorCostPct))}</td>
            {need && <td>{hours === null ? "—" : hoursText(hours)}</td>}
          </tr>;
        })}</tbody>
      </table></div>
      {need && <p className="status-note">Hours for the {number(need.pointsNeeded)} points still needed at {money(need.betCents)} a hand.</p>}
    </>}
  </section>;
}

/** Start a pace session: full Free Play hands on one of your machines, with a target pace and an accuracy bar. */
export function PaceDialog({ machines, wallets, program, need, tripId, accuracyPct, feedbackMode, fallbackPace, busy, run, onClose, onStarted }: {
  machines: Machine[]; wallets: Wallet[]; program: Program; need: Omit<TripNeed, "betCents"> | null; tripId?: string;
  accuracyPct: number; feedbackMode: FeedbackMode; fallbackPace: number; busy: boolean; run: Run; onClose: () => void; onStarted: () => void;
}) {
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const machine = machines.find(item => item.id === machineId);
  const needed = machine && need ? neededPace(need.pointsNeeded, program.dollarsPerPoint, betCents(machine), need.hoursLeft) : null;
  const suggested = Math.round(Math.min(3000, Math.max(100, needed ?? fallbackPace)));
  const [target, setTarget] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState(String(accuracyPct));
  const [feedback, setFeedback] = useState<FeedbackMode>(feedbackMode);
  const [error, setError] = useState("");
  const targetText = target ?? String(suggested);
  async function start(event: FormEvent) {
    event.preventDefault();
    setError("");
    const targetHandsPerHour = Number(targetText);
    if (!machine) { setError("Add a machine first."); return; }
    if (!Number.isInteger(targetHandsPerHour) || targetHandsPerHour < 100 || targetHandsPerHour > 3000) { setError("Choose a target between 100 and 3,000 hands per hour."); return; }
    const wallet = wallets.find(item => item.id === machine.defaultWalletId);
    if (!wallet) { setError("This machine's wallet was deleted. Edit the machine to choose another wallet."); return; }
    const bet = betCents(machine);
    if (wallet.balanceCents < bet) { setError(`${wallet.name} has ${money(wallet.balanceCents)}, less than one ${money(bet)} bet. Add credits on the Wallets page.`); return; }
    await run(async () => {
      await sessionService.start({ machineId: machine.id, walletId: wallet.id, mode: "free_play", feedbackMode: feedback, pace: { targetHandsPerHour, accuracyPct: Number(accuracy), tripId } });
      onStarted();
    }, { onError: setError });
  }
  return <Modal error={error} title="Train your pace" subtitle="Full Free Play hands, timed. Breaks over a minute don't count against you." onClose={onClose}>
    {!machines.length ? <><p className="settings-copy">Pace sessions play on one of your machines. Add one on the Machines page first.</p>
      <div className="form-actions"><a className="btn" href="#/">Go to machines</a></div></> :
    <form onSubmit={event => void start(event)}>
      <div className="form-grid">
        <Field label="Machine" full><select aria-label="Machine" value={machineId} onChange={event => { setMachineId(event.target.value); setTarget(null); }}>
          {machines.map(item => <option key={item.id} value={item.id}>{item.name} · {money(betCents(item))} a hand</option>)}
        </select></Field>
        <Field label="Target hands per hour"><input aria-label="Target hands per hour" inputMode="numeric" value={targetText} onChange={event => setTarget(event.target.value)} /></Field>
      </div>
      <p className="form-hint">{needed !== null && machine
        ? `Your trip needs about ${number(needed)} hands/hr at ${money(betCents(machine))} a hand to reach its target in the ${hoursText(need!.hoursLeft)} left.`
        : `No trip pace to aim for, so this starts at ${number(fallbackPace)} hands/hr.`}</p>
      <p className="field-label">Accuracy bar (EV kept)</p>
      <ChoiceChips label="Accuracy bar" value={accuracy} onChange={setAccuracy} choices={ACCURACY_CHOICES.map(value => ({ value: String(value), label: accuracyLabel(value) }))} />
      <p className="form-hint">99.9% is a sensible bar: mistakes then cost about 0.1% of return.</p>
      <p className="field-label">Mistakes</p>
      <ChoiceChips label="Mistake feedback" value={feedback} onChange={setFeedback} choices={FEEDBACK_CHOICES.map(choice => ({ value: choice.value, label: choice.label }))} />
      <p className="form-hint">{FEEDBACK_CHOICES.find(choice => choice.value === feedback)?.note}</p>
      <div className="form-actions"><button className="btn secondary" type="button" onClick={onClose}>Cancel</button><button className="btn" type="submit" disabled={busy}>{busy ? "Starting…" : "Start pace session"}</button></div>
    </form>}
  </Modal>;
}
