import { handPaytableId } from "../services/bet";
import { describeLabel } from "@perfect-draw/engine";
import type { Session } from "@perfect-draw/shared";
import { Button, CoinAmount, Disclosure } from "../components/ui";
import { Icon } from "../components/Icons";
import { CardFace } from "./CardFace";
import { cardName, maskIndexes } from "./cards";
import { HoldComparison } from "./HoldComparison";
import { encodeAnalyzerQuery } from "../analyzer/hand-input";

type Grade = NonNullable<Session["state"]["feedback"]>;

export const gradeLabel = (label: string, familyId: string) => {
  try { return describeLabel(label, familyId as Parameters<typeof describeLabel>[1]); }
  catch { return label; }
};
const familyOf = (session: Session) => session.state.analysis?.familyId ?? "jacks_or_better";
const multiLine = (session: Session) => session.mode === "free_play" && session.machineSnapshot.lines > 1;

function Ev({ value, session }: { value: number; session: Session }) {
  return <CoinAmount amount={value} denominationCents={session.machineSnapshot.denominationCents} digits={3} />;
}

/** Five small cards from the original deal with the held ones raised, so a hold reads at a glance. */
function HoldStrip({ label, description, mask, hand }: { label: string; description: string; mask: number; hand: readonly number[] }) {
  const held = maskIndexes(mask).map(index => cardName(hand[index]));
  return <div className="hold-strip">
    <div className="hold-strip-text"><span>{label}</span><strong>{description}</strong></div>
    <div className="hold-strip-cards" role="img" aria-label={`${label}: ${held.length ? held.join(", ") : "no cards held"}`}>
      {hand.map((card, index) => <span key={`${card}-${index}`} className={`mini-card ${(mask & (1 << index)) ? "is-held" : "is-discarded"}`}><CardFace card={card} variant="compact" /></span>)}
    </div>
  </div>;
}

/** The full breakdown: both holds as cards, their expected values and the cost of the difference. */
export function DecisionDetails({ grade, session }: { grade: Grade; session: Session }) {
  const familyId = familyOf(session);
  const hand = session.state.analysis?.hand ?? [];
  return <div className="decision-details">
    {hand.length === 5 && <div className="hold-strips">
      <HoldStrip label="Your hold" description={gradeLabel(grade.chosenLabel, familyId)} mask={grade.chosenMask} hand={hand} />
      {!grade.correct && <HoldStrip label="Best hold" description={gradeLabel(grade.bestLabel, familyId)} mask={grade.bestMask} hand={hand} />}
    </div>}
    <div className="feedback-metrics">
      <div className="feedback-metric"><span>Your hold · expected value</span><strong><Ev value={grade.chosenEv} session={session} /></strong></div>
      <div className="feedback-metric"><span>Best hold · expected value</span><strong><Ev value={grade.bestEv} session={session} /></strong></div>
      <div className="feedback-metric"><span>{multiLine(session) ? `EV lost · per line / all ${session.machineSnapshot.lines} lines` : "EV lost"}</span>
        <strong><Ev value={grade.evLoss} session={session} />{multiLine(session) && <> <span className="ev-divider">/</span> <Ev value={grade.totalEvLoss} session={session} /></>}</strong></div>
    </div>
    <p className="decision-note">Expected value is the average return of a hold over every possible draw, in credits per line. Equivalent holds count as optimal.
      {hand.length === 5 && <> <a className="analyzer-link" href={`#/analyze?${encodeAnalyzerQuery({ hand, paytableId: handPaytableId(session), coins: session.state.handCoins ?? session.machineSnapshot.coins, held: grade.chosenMask })}`}>Open in analyzer</a></>}</p>
    {hand.length === 5 && session.state.analysis && <Disclosure className="why-disclosure"
      summary={grade.correct ? "Why is this the best hold? Compare it with others" : "Why is the best hold better? See what each hold can make"}>
      <HoldComparison session={session} grade={grade} />
    </Disclosure>}
  </div>;
}

function DetailsToggle({ open, onToggle, id }: { open: boolean; onToggle: () => void; id: string }) {
  return <button type="button" className="details-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
    {open ? "Hide details" : "Details"}<Icon name="chevron-down" size={15} />
  </button>;
}

/** Optimal hold: a quiet confirmation pill. Details stay one click away. */
export function OptimalFeedback({ grade, session, open, onToggle }: { grade: Grade; session: Session; open: boolean; onToggle: () => void }) {
  const id = `details-${session.state.handId ?? "hand"}`;
  return <div className="grade grade-optimal" role="status">
    <div className="grade-pill">
      <span className="grade-mark" aria-hidden="true"><Icon name="check" size={16} /></span>
      <h3>Optimal hold</h3>
      <span className="grade-label">{gradeLabel(grade.bestLabel, familyOf(session))}</span>
      <DetailsToggle open={open} onToggle={onToggle} id={id} />
    </div>
    {open && <div id={id} className="grade-drawer"><DecisionDetails grade={grade} session={session} /></div>}
  </div>;
}

/** A weaker hold was played: one line with the better hold and its cost; details open below by default. */
export function MistakeFeedback({ grade, session, open, onToggle }: { grade: Grade; session: Session; open: boolean; onToggle: () => void }) {
  const id = `details-${session.state.handId ?? "hand"}`;
  const hand = session.state.analysis?.hand ?? [];
  return <div className="grade grade-mistake" role="status">
    <div className="grade-bar">
      <span className="grade-mark" aria-hidden="true"><Icon name="x" size={15} /></span>
      <div className="grade-text">
        <h3>A different hold was stronger</h3>
        <p>Best: <strong>{gradeLabel(grade.bestLabel, familyOf(session))}</strong>{hand.length === 5 && <span className="grade-cards" aria-hidden="true">{maskIndexes(grade.bestMask).map(index => <span key={index} className="mini-card"><CardFace card={hand[index]} variant="compact" /></span>)}</span>}</p>
      </div>
      <span className="grade-cost"><span className="grade-cost-label">Cost</span><Ev value={multiLine(session) ? grade.totalEvLoss : grade.evLoss} session={session} /></span>
      <DetailsToggle open={open} onToggle={onToggle} id={id} />
    </div>
    {open && <div id={id} className="grade-drawer"><DecisionDetails grade={grade} session={session} /></div>}
  </div>;
}

/** Warn-before-draw: the hand pauses before the draw. The suggested cards are outlined on the table itself. */
export function HoldReview({ grade, session, busy, open, onToggle, onUseBest, onDrawAnyway }: {
  grade: Grade; session: Session; busy: boolean; open: boolean; onToggle: () => void; onUseBest: () => void; onDrawAnyway: () => void;
}) {
  const id = `review-${session.state.handId ?? "hand"}`;
  return <div className="grade grade-review" role="alert">
    <div className="grade-bar">
      <span className="grade-mark" aria-hidden="true"><Icon name="warning" size={16} /></span>
      <div className="grade-text">
        <h3>Hold review</h3>
        <p>A stronger hold exists: <strong>{gradeLabel(grade.bestLabel, familyOf(session))}</strong>, outlined above. Your hold costs <Ev value={multiLine(session) ? grade.totalEvLoss : grade.evLoss} session={session} />.</p>
      </div>
      <DetailsToggle open={open} onToggle={onToggle} id={id} />
    </div>
    <div className="feedback-actions">
      <Button variant="gold" icon="restore" disabled={busy} onClick={onUseBest}>Use best hold</Button>
      <Button variant="secondary" data-play-action="submit" disabled={busy} onClick={onDrawAnyway}>Draw anyway</Button>
      <span className="review-note">Your first choice is already recorded.</span>
    </div>
    {open && <div id={id} className="grade-drawer"><DecisionDetails grade={grade} session={session} /></div>}
  </div>;
}
