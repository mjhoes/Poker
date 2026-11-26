import type { Session } from "@perfect-draw/shared";
import { Badge } from "../components/ui";
import { money } from "../components/UiHelpers";
import { mistakeCostPerPointCents } from "./pace";
import { useProgram, useSessionPace } from "./useCruise";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

/**
 * Casino-Pace Mode's meter in the session room: hands per hour over the last 20 hands against the target, and the
 * accuracy bar. With quiet feedback the accuracy stays hidden until the session closes, like a real machine.
 */
export function PaceMeter({ session }: { session: Session }) {
  const pace = useSessionPace(session.id);
  const program = useProgram();
  if (!session.pace) return null;
  const { targetHandsPerHour: target, accuracyPct } = session.pace;
  const closed = session.status === "closed";
  const quiet = session.state.feedbackMode === "silent_report" && !closed;
  const current = closed ? pace?.handsPerHour ?? null : pace?.recentHandsPerHour ?? null;
  const fill = current === null ? 0 : Math.min(1, current / (target * 1.5));
  const kept = pace?.evKeptPct ?? null;
  const held = kept !== null && kept + 1e-9 >= accuracyPct;
  return <section className="panel panel-pad pace-meter" aria-label="Casino pace">
    <div className="pace-head"><p className="eyebrow">CASINO PACE</p>
      {current !== null && <Badge tone={current >= target ? "success" : "warning"} dot>{current >= target ? "On pace" : "Speed up"}</Badge>}</div>
    <div className="pace-now"><strong>{current === null ? "—" : number(current)}</strong><span>hands/hr {closed ? "this session" : "over the last 20 hands"}</span></div>
    <div className="pace-track" role="meter" aria-label="Pace against target" aria-valuemin={0} aria-valuemax={Math.round(target * 1.5)} aria-valuenow={current === null ? 0 : Math.round(current)}
      aria-valuetext={current === null ? "Not measured yet" : `${number(current)} hands per hour; target ${number(target)}`}>
      <span className="pace-fill" style={{ width: `${fill * 100}%` }} />
      <span className="pace-target" style={{ left: `${100 / 1.5}%` }} title={`Target ${number(target)} hands/hr`} />
    </div>
    <p className="pace-note">Target <strong>{number(target)} hands/hr</strong>{current === null ? ". Play a few hands to measure your pace (breaks over a minute don't count)." : pace?.handsPerHour != null && !closed ? `. Session so far: ${number(pace.handsPerHour)} hands/hr.` : "."}</p>
    <div className="metric-row"><span>Accuracy bar</span><strong>{number(accuracyPct, 2)}% of perfect play's EV</strong></div>
    {quiet ? <p className="status-note">Accuracy shows when you close the session (quiet feedback, like a real machine).</p>
      : kept !== null && <>
        <div className="metric-row"><span>EV kept</span><strong className={held ? "positive" : "negative"}>{number(kept, 2)}% · {held ? "bar held" : "below your bar"}</strong></div>
        {pace?.errorCostPct != null && <div className="metric-row"><span>Mistakes cost</span><strong>{number(pace.errorCostPct, 2)}% of return{program ? ` · ${money(mistakeCostPerPointCents(program.dollarsPerPoint, pace.errorCostPct))} a point` : ""}</strong></div>}
      </>}
  </section>;
}

/** A compact pace readout on the table itself, so it stays in view while playing (phones show the meter below). */
export function PaceChip({ session }: { session: Session }) {
  const pace = useSessionPace(session.id);
  if (!session.pace || session.status === "closed") return null;
  const current = pace?.recentHandsPerHour ?? null;
  const target = session.pace.targetHandsPerHour;
  return <span className={`pace-chip ${current === null ? "" : current >= target ? "is-on" : "is-under"}`} aria-label={current === null ? `Pace not measured yet; target ${number(target)} hands per hour` : `Pace ${number(current)} hands per hour; target ${number(target)}`}>
    {current === null ? "—" : number(current)} / {number(target)} per hr
  </span>;
}
