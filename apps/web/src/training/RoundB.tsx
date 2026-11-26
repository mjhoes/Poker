import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import type { Machine, Session } from "@perfect-draw/shared";
import { Button, Segmented } from "../components/ui";
import { errorMessage } from "../hooks/useActionRunner";
import { db, live } from "../data/db";
import { findPaytable, useAllPaytables } from "../paytables/catalog";
import { gradeLabel } from "../table/Feedback";
import { maskIndexes, shortCard } from "../table/cards";
import { trainingService } from "../services/training";
import type { LadderChart, LadderTier } from "../worker/engine-api";
import { LADDER_STREAK, ladderNewest, switcherRoundDealt } from "./plans";
import { useLadderChart, useLadderProgress } from "./useTraining";

/*
 * Round B on the Train page and in the session room (docs/16-ADAPTIVE-TRAINING-ROUND-B.md): the Strategy Ladder and the
 * Pay Table Switcher.
 */

const TIERS: readonly LadderTier[] = ["Beginner", "Intermediate", "Expert"];
export type RoundBStart = { kind: "ladder"; tier: LadderTier; restart?: boolean } | { kind: "switcher"; compareWith: string[] };
const lineText = (line: LadderChart["lines"][number], familyId: string) =>
  (line.alternatives ?? [line.label]).map(label => gradeLabel(label, familyId)).join(" or ");
const percent = (value: number) => `${value < 1 ? value.toFixed(2) : value.toFixed(1)}%`;

export function LadderPanel({ machine, busy, onStart }: { machine: Machine; busy: boolean; onStart: (input: RoundBStart) => void }) {
  const [tier, setTier] = useState<LadderTier>("Expert");
  const info = useLadderChart(machine.paytableId, tier);
  const progress = useLadderProgress(machine.paytableId, tier);
  const chart = info?.chart;
  const lines = chart ? chart.lines.flatMap((line, index) => line.dealable ? [index] : []) : [];
  // Progress counts only for the chart as it is now (a rebuilt chart starts again).
  const current = progress && progress.lines.join(",") === lines.join(",") ? progress : null;
  const state = { tier, lines, step: current?.step ?? 1, streak: current?.streak ?? 0, pending: null, progressAt: 0 };
  const newest = lines.length ? ladderNewest(state) : null;
  const learned = (index: number) => { const at = lines.indexOf(index); return at >= 0 && at < state.step - 1; };
  return <section className="panel panel-pad train-panel" aria-labelledby="ladder-title">
    <p className="eyebrow">STRATEGY LADDER</p><h2 id="ladder-title">Climb a strategy chart</h2>
    <p className="train-copy">One line at a time, top-down. {LADDER_STREAK} right in a row on the newest line unlocks the next, with earlier lines mixed in. Charts are for max bet, so the ladder deals at 5 coins.</p>
    <Segmented label="Chart" value={tier} onChange={setTier} options={TIERS.map(value => ({ value, label: value }))} />
    {!info || (!chart && !info.error) ? <p className="status-note" role="status">Loading the {tier} chart… A table's first charts take about 20 seconds.</p>
      : info.error ? <p className="status-note" role="alert">Couldn't load the chart: {info.error}</p>
      : chart && <>
        <div className="ladder-progress" role="group" aria-label="Ladder progress">
          <strong>{newest === null ? `All ${lines.length} lines learned` : `Line ${newest + 1} of ${chart.lines.length}`}</strong>
          <span>{newest === null ? "Mixed review of every line." : lineText(chart.lines[newest], chart.familyId)}</span>
          <span className="muted">{state.step - 1 > lines.length ? lines.length : state.step - 1} of {lines.length} learned{newest !== null && state.streak ? ` · ${state.streak} of ${LADDER_STREAK} right in a row` : ""}</span>
          <progress max={lines.length} value={Math.min(lines.length, state.step - 1)} aria-label="Lines learned" />
        </div>
        <details className="ladder-chart"><summary>The {tier} chart: {chart.lines.length} lines, returns {chart.returnPct.toFixed(2)}% (perfect play {chart.optimalReturnPct.toFixed(2)}%)</summary>
          <ol>{chart.lines.map((line, index) => <li key={index} className={index === newest ? "is-current" : learned(index) ? "is-learned" : ""}>
            <span>{lineText(line, chart.familyId)}</span>
            <small>{!line.dealable ? "No deal to practice" : index === newest ? "Learning" : learned(index) ? "Learned" : ""}</small>
          </li>)}</ol>
        </details>
        <div className="train-actions">
          <Button variant="gold" icon="play" disabled={busy} onClick={() => onStart({ kind: "ladder", tier })}>{current ? "Continue ladder" : "Start ladder"}</Button>
          {current && <Button variant="secondary" size="sm" disabled={busy} onClick={() => onStart({ kind: "ladder", tier, restart: true })}>Start over</Button>}
        </div>
      </>}
  </section>;
}

export function SwitcherPanel({ machine, busy, onStart }: { machine: Machine; busy: boolean; onStart: (input: RoundBStart) => void }) {
  const all = useAllPaytables();
  const familyId = all.find(table => table.id === machine.paytableId)?.familyId;
  const candidates = all.filter(table => table.familyId === familyId && table.id !== machine.paytableId);
  const candidateKey = candidates.map(table => table.id).join(",");
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => setChosen(candidates.slice(0, 1).map(table => table.id)), [machine.paytableId, candidateKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const differKey = `${machine.paytableId}:${machine.coins}:${chosen.join(",")}`;
  const [differ, setDiffer] = useState<{ key: string; value?: Record<string, number>; error?: string } | null>(null);
  useEffect(() => {
    if (!chosen.length) return;
    let cancelled = false;
    setDiffer({ key: differKey });
    trainingService.switcherDiffer(machine.paytableId, chosen, machine.coins)
      .then(rows => { if (!cancelled) setDiffer({ key: differKey, value: Object.fromEntries(rows.map(row => [row.paytableId, row.differPct])) }); },
        reason => { if (!cancelled) setDiffer({ key: differKey, error: errorMessage(reason) }); });
    return () => { cancelled = true; };
  }, [differKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key names every input
  const shown = differ?.key === differKey ? differ : null;
  const toggle = (id: string) => setChosen(list => list.includes(id) ? list.filter(item => item !== id) : list.length < 2 ? [...list, id] : list);
  return <section className="panel panel-pad train-panel" aria-labelledby="switcher-title">
    <p className="eyebrow">PAY TABLE SWITCHER</p><h2 id="switcher-title">Same hand, different pay tables</h2>
    <p className="train-copy">Each hand is dealt on this machine's table, then the same cards on each table you pick, so you learn which plays change. Most hands are ones where the best hold does.</p>
    {!candidates.length ? <p className="status-note">No other pay table of this game yet. Add one on the Pay tables page to compare.</p> : <>
      <fieldset className="switcher-tables"><legend className="field-label">Compare with (up to 2), at {machine.coins} {machine.coins === 1 ? "coin" : "coins"}</legend>
        {candidates.map(table => <label key={table.id} className="ai-check switcher-option">
          <input type="checkbox" checked={chosen.includes(table.id)} disabled={!chosen.includes(table.id) && chosen.length >= 2} onChange={() => toggle(table.id)} />
          <span><strong>{table.name}</strong>{chosen.includes(table.id) && <> {shown?.error ? "Couldn't compare." : shown?.value ? `Best hold differs on ${percent(shown.value[table.id])} of deals.` : "Comparing…"}</>}</span>
        </label>)}
      </fieldset>
      {shown?.error && <p className="status-note" role="alert">{shown.error}</p>}
      <Button variant="gold" icon="play" disabled={busy || !chosen.length} onClick={() => onStart({ kind: "switcher", compareWith: chosen })}>Start Switcher</Button>
    </>}
  </section>;
}

/** The session room's note for a Strategy Ladder: where you are on the chart, and what this hand practices. */
export function LadderNote({ session }: { session: Session }) {
  const ladder = session.training!.ladder!;
  const info = useLadderChart(session.machineSnapshot.paytableId, ladder.tier);
  const chart = info?.chart;
  const newest = ladderNewest(ladder);
  const name = (index: number) => chart ? lineText(chart.lines[index], chart.familyId) : "…";
  return <>
    <p className="eyebrow">STRATEGY LADDER · {ladder.tier.toUpperCase()} CHART</p>
    <h2>{newest === null ? `Mixed review of all ${ladder.lines.length} lines` : `Line ${newest + 1}${chart ? ` of ${chart.lines.length}` : ""}: ${name(newest)}`}</h2>
    <span>{newest === null ? "You've learned every line of this chart." : `${ladder.streak} of ${LADDER_STREAK} right in a row on this line · ${ladder.step - 1} of ${ladder.lines.length} learned.`}</span>
    {ladder.pending !== null && <span className="ladder-hand"> This hand: line {ladder.pending + 1}{ladder.pending === newest ? " (new)" : " (review)"}.</span>}
  </>;
}

/** The session room's note for a Pay Table Switcher round: which table this hand is on, then how the tables compare. */
export function SwitcherNote({ session }: { session: Session }) {
  const switcher = session.training!.switcher!;
  const round = switcher.round;
  const index = round ? Math.min(round.next, switcher.tables.length) - 1 : 0;
  const name = (id: string) => findPaytable(id)?.name ?? "Pay table";
  const finished = switcherRoundDealt(switcher) && session.state.phase === "complete";
  const handKey = round?.hand.join(",") ?? "";
  const [answers, setAnswers] = useState<{ paytableId: string; bestLabel: string; bestMask: number; chosenMask: number; correct: boolean }[]>([]);
  useEffect(() => {
    if (!finished) { setAnswers([]); return; }
    const subscription = liveQuery(async () => (await db.records("decisions").where("sessionId").equals(session.id).toArray())
      .filter(row => live(row) && !row.isCorrection && row.dealtCards.join(",") === handKey))
      .subscribe({ next: rows => setAnswers(rows.map(row => ({ paytableId: row.paytableId, bestLabel: row.bestLabel, bestMask: row.bestMask, chosenMask: row.chosenMask, correct: row.evLoss <= 1e-9 }))), error: () => setAnswers([]) });
    return () => subscription.unsubscribe();
  }, [session.id, handKey, finished]);
  const familyId = session.state.analysis?.familyId ?? "";
  const held = (mask: number) => round ? maskIndexes(mask).map(at => shortCard(round.hand[at])).join(" ") || "Draw five" : "";
  return <>
    <p className="eyebrow">PAY TABLE SWITCHER</p>
    <h2>{round ? `${name(switcher.tables[index])} · table ${index + 1} of ${switcher.tables.length}` : `${name(switcher.tables[0])} first`}</h2>
    <span>{round ? "The same cards on each table in turn. Does the best hold change?" : `Then the same cards on ${switcher.tables.slice(1).map(name).join(" and ")}.`}</span>
    {finished && answers.length > 0 && <ul className="switcher-compare" aria-label="This hand on each table">
      {switcher.tables.map(id => {
        const answer = answers.find(row => row.paytableId === id);
        return answer && <li key={id} className={answer.correct ? "is-right" : "is-wrong"}>
          <strong>{name(id)}</strong><span>Best: {held(answer.bestMask)} · {gradeLabel(answer.bestLabel, familyId)}</span>
          <span>{answer.correct ? "You had it" : `You held ${held(answer.chosenMask)}`}</span>
        </li>;
      })}
    </ul>}
  </>;
}
