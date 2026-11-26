import { useEffect, useState } from "react";
import type { Machine } from "@perfect-draw/shared";
import { Badge, Button } from "../components/ui";
import type { Run } from "../hooks/useActionRunner";
import { errorMessage } from "../hooks/useActionRunner";
import { gradeLabel } from "../table/Feedback";
import { findPaytable } from "../paytables/catalog";
import { trainingService } from "../services/training";
import { graduated, handsSeen, priority, reviewable } from "../training/core";
import type { Card, ReviewScope, Target } from "../training/core";
import { useReview, useTrainingTable } from "../training/useTraining";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const when = (at: number, now: number) => {
  if (at <= now) return "Due now";
  const minutes = Math.round((at - now) / 60_000);
  if (minutes < 60) return `In ${minutes} min`;
  const days = Math.round((at - now) / 86_400_000);
  return days < 1 ? `In ${Math.round(minutes / 60)} h` : days === 1 ? "Tomorrow" : `In ${days} days`;
};

/** The daily cap, saved when it changes (5–500). */
function CapSetting({ cap, run }: { cap: number; run: Run }) {
  const [text, setText] = useState(String(cap));
  useEffect(() => setText(String(cap)), [cap]);
  const value = Number(text);
  const valid = Number.isInteger(value) && value >= 5 && value <= 500;
  return <label className="field cap-field"><span className="field-label">Reviews a day</span>
    <span className="cap-row"><input aria-label="Reviews a day" inputMode="numeric" value={text} onChange={event => setText(event.target.value)} />
      <Button variant="secondary" size="sm" disabled={!valid || value === cap} onClick={() => void run(() => trainingService.setDailyCap(value), { success: `Up to ${value} reviews a day.` })}>Save</Button></span>
    {!valid && <small className="field-note">Between 5 and 500.</small>}</label>;
}

/**
 * The game's cards. A card hidden by an open quiet session shows no results or schedule (and sorts last, since its
 * cost would give them away); a card this table can't deal says so instead of "Due".
 */
function CardsList({ cards, familyId, now, scope }: { cards: Card[]; familyId: string; now: number; scope: Required<ReviewScope> }) {
  if (!cards.length) return <p className="status-note">No cards yet. Every hand you play adds the category of its best hold as a card.</p>;
  const hidden = (card: Card) => scope.hidden.has(card.label);
  const rows = [...cards].sort((a, b) => Number(hidden(a)) - Number(hidden(b)) ||
    (hidden(a) ? a.label.localeCompare(b.label) : priority(b) - priority(a) || a.dueAt - b.dueAt));
  const hiddenCount = cards.filter(hidden).length;
  const elsewhere = cards.some(card => !hidden(card) && !scope.available.has(card.label));
  return <>
    {hiddenCount > 0 && <p className="status-note train-hidden">{number(hiddenCount)} {hiddenCount === 1 ? "card holds hands" : "cards hold hands"} from an open session with quiet feedback. {hiddenCount === 1 ? "Its results show" : "Their results show"} here when you close it.</p>}
    <div className="table-scroll"><table className="ledger train-cards">
      <thead><tr><th>Best hold</th><th>Hands</th><th>Right</th><th>Next review</th><th><span className="visually-hidden">Status</span></th></tr></thead>
      <tbody>{rows.map(card => <tr key={card.id}>
        <td>{gradeLabel(card.label, familyId)}</td>
        <td>{number(handsSeen(card))}</td>
        {hidden(card) ? <><td>Hidden</td><td>After your quiet session</td><td /></> : <>
          <td>{number(card.alpha - 1)} of {number(handsSeen(card))}</td>
          <td>{scope.available.has(card.label) ? when(card.dueAt, now) : "Not on this table"}</td>
          <td>{graduated(card) ? <Badge tone="success">Mastered</Badge> : card.dueAt <= now && reviewable(card, scope) ? <Badge tone="warning">Due</Badge> : null}</td>
        </>}
      </tr>)}</tbody>
    </table></div>
    {elsewhere && <p className="status-note">"Not on this table": that hold is never the best play on this pay table at this bet, so review it on a machine where it is.</p>}
  </>;
}

export function TrainPage({ machines, busy, run, onOpenRoom }: { machines: Machine[]; busy: boolean; run: Run; onOpenRoom: () => void }) {
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const machine = machines.find(item => item.id === machineId) ?? machines[0];
  const tableInfo = useTrainingTable(machine?.paytableId, machine?.coins);
  const table = tableInfo?.table ?? null;
  const familyId = table?.familyId ?? null;
  const review = useReview(table);
  const [targets, setTargets] = useState<{ key: string; value?: Target[]; error?: string } | null>(null);
  const [gap, setGap] = useState(0.1);
  const now = Date.now();
  const targetsKey = machine ? `${machine.paytableId}:${machine.coins}` : "";

  useEffect(() => {
    if (!machine) return;
    let cancelled = false;
    setTargets({ key: targetsKey });
    trainingService.weaknessTargets(machine.paytableId, machine.coins)
      .then(value => { if (!cancelled) setTargets({ key: targetsKey, value }); }, reason => { if (!cancelled) setTargets({ key: targetsKey, error: errorMessage(reason) }); });
    return () => { cancelled = true; };
  }, [targetsKey, review?.version]); // eslint-disable-line react-hooks/exhaustive-deps -- re-rank as answers land and quiet sessions close

  async function start(kind: "review" | "weakness" | "close_calls", keepGoing = false) {
    if (!machine) return;
    const ok = await run(() => trainingService.start({ machineId: machine.id, kind, closeCallPerCoin: gap, keepGoing }));
    if (ok) onOpenRoom();
  }

  const heading = <div className="page-heading"><div><p className="eyebrow">TRAIN</p><h1>Practice what costs you most.</h1></div>
    <p className="heading-note">Reviews bring back what you're starting to forget; the trainers aim at your costliest mistakes.</p></div>;
  if (!machine) return <>{heading}<div className="empty-state"><div className="empty-mark" aria-hidden="true">T</div><h2>Add a machine first</h2>
    <p>Training plays Rapid Drill hands on one of your machines, so it uses that machine's game and pay table.</p><a className="btn" href="#/">Go to machines</a></div></>;

  const queue = review?.queue;
  const shownTargets = targets?.key === targetsKey ? targets : null;
  const tableName = findPaytable(machine.paytableId)?.name ?? machine.name;
  return <>
    {heading}
    <div className="train-bar">
      <label className="field train-machine"><span className="field-label">Machine</span>
        <select aria-label="Training machine" value={machine.id} onChange={event => setMachineId(event.target.value)}>
          {machines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      <p className="muted">{tableName} · {machine.coins} {machine.coins === 1 ? "coin" : "coins"}</p>
    </div>

    <div className="train-grid">
      <section className="panel panel-pad train-panel" aria-labelledby="review-title">
        <p className="eyebrow">TODAY'S REVIEW</p><h2 id="review-title">{!queue ? "…" : queue.due.length ? `${number(queue.due.length)} due now` : "Nothing due now"}</h2>
        {tableInfo?.error && <p className="status-note" role="alert">Couldn't read this table's categories: {tableInfo.error}</p>}
        {queue && <p className="train-copy">{number(queue.done)} of {number(queue.cap)} reviewed today (all games){queue.dueToday > queue.due.length ? ` · ${number(queue.dueToday - queue.due.length)} more due later today` : ""}.</p>}
        {queue && (queue.capReached && queue.due.length
          ? <><p className="train-copy">That's today's reviews. {number(queue.due.length)} more {queue.due.length === 1 ? "is" : "are"} due if you want to keep going.</p>
            <Button variant="gold" icon="play" disabled={busy} onClick={() => void start("review", true)}>Keep going</Button></>
          : <Button variant="gold" icon="play" disabled={busy || !queue.leftToday} onClick={() => void start("review")}>{queue.leftToday ? `Start review (${number(queue.leftToday)})` : "Start review"}</Button>)}
        {queue && !queue.due.length && <p className="status-note">Cards come from every hand you play. Right answers come back after days or weeks; mistakes come back in 10 minutes.</p>}
        {review && <CapSetting cap={review.cap} run={run} />}
      </section>

      <section className="panel panel-pad train-panel" aria-labelledby="weakness-title">
        <p className="eyebrow">WEAKNESS TRAINER</p><h2 id="weakness-title">Your costliest mistakes</h2>
        <p className="train-copy">70% of hands from these, 20% due reviews, 10% ordinary hands so you don't just learn the pattern.</p>
        {!shownTargets || (!shownTargets.value && !shownTargets.error) ? <p className="status-note">Reading your statistics…</p>
          : shownTargets.error ? <p className="status-note" role="alert">Couldn't read your statistics: {shownTargets.error}</p>
          : shownTargets.value!.length ? <ol className="weakness-list">{shownTargets.value!.map(target => <li key={`${target.bestLabel}\t${target.chosenLabel}`}>
            <strong>{gradeLabel(target.bestLabel, familyId ?? "")}</strong><span>your hold: {gradeLabel(target.chosenLabel, familyId ?? "")}</span></li>)}</ol>
          : <p className="status-note">No costly mistakes on this table yet. Play some hands, or the trainer will mix reviews and ordinary hands.</p>}
        {!!review?.queue.hidden.size && <p className="status-note">Hands from your open session with quiet feedback join this list when you close it.</p>}
        <Button variant="gold" icon="play" disabled={busy} onClick={() => void start("weakness")}>Start Weakness Trainer</Button>
      </section>

      <section className="panel panel-pad train-panel" aria-labelledby="close-title">
        <p className="eyebrow">CLOSE CALLS</p><h2 id="close-title">When two holds are nearly equal</h2>
        <p className="train-copy">Only hands where the best two holds are within this much of each other. Smaller is harder.</p>
        <label className="field"><span className="field-label">Within {number(gap, 2)} credits per coin ({number(gap * machine.coins, 2)} at {machine.coins} {machine.coins === 1 ? "coin" : "coins"})</span>
          <input aria-label="Close-call gap" type="range" min={0.01} max={0.5} step={0.01} value={gap} onChange={event => setGap(Number(event.target.value))} /></label>
        <Button variant="gold" icon="play" disabled={busy} onClick={() => void start("close_calls")}>Start Close Calls</Button>
      </section>
    </div>

    <section className="panel panel-pad cruise-panel" aria-labelledby="cards-title">
      <div className="panel-title"><div><p className="eyebrow">YOUR CARDS</p><h2 id="cards-title">Every best-hold category you've played</h2>
        <p>Most costly first. Mastered = under 2% mistakes over 30+ hands.</p></div></div>
      {review && table ? <CardsList cards={review.cards} familyId={table.familyId} now={now} scope={{ available: table.available, hidden: review.queue.hidden }} />
        : <p className="status-note">{tableInfo?.error ? "Couldn't load your cards." : "Loading…"}</p>}
    </section>
  </>;
}
