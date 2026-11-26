import type { Session } from "@perfect-draw/shared";
import { Button } from "../components/ui";
import type { Run } from "../hooks/useActionRunner";
import { gradeLabel } from "../table/Feedback";
import { trainingService } from "../services/training";
import { betForNextDeal } from "../services/bet";
import { useFamily, useReview, useTrainingTable } from "./useTraining";
import { LadderNote, SwitcherNote } from "./RoundB";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** What a training session is practicing, and for a review, how many are left today (with Keep going past the cap). */
export function TrainingNote({ session, busy, run }: { session: Session; busy: boolean; run: Run }) {
  const training = session.training;
  const familyId = useFamily(session.machineSnapshot.paytableId);
  const table = useTrainingTable(training?.kind === "review" ? session.machineSnapshot.paytableId : undefined, betForNextDeal(session));
  const review = useReview(table?.table ?? null, training?.keepGoing ?? false);
  if (!training) return null;
  const queue = review?.queue;
  return <section className="focused-drill-note training-note" aria-label="Training plan">
    {training.kind === "ladder" ? <LadderNote session={session} />
    : training.kind === "switcher" ? <SwitcherNote session={session} />
    : training.kind === "review" ? <>
      <p className="eyebrow">TODAY'S REVIEW</p>
      {!queue ? <h2>…</h2> : queue.next ? <>
        <h2>{training.keepGoing ? `${number(queue.due.length)} due` : `${number(queue.leftToday)} left today`}</h2>
        <span>Each hand is a card that's due: {gradeLabel(queue.next.label, familyId ?? "")} is next.</span>
      </> : queue.capReached && queue.due.length && !training.keepGoing ? <>
        <h2>That's today's reviews</h2>
        <span>{number(queue.due.length)} more {queue.due.length === 1 ? "is" : "are"} due. </span>
        {session.status !== "closed" && <Button variant="gold" size="sm" icon="play" disabled={busy} onClick={() => void run(() => trainingService.keepGoing(session.id))}>Keep going</Button>}
      </> : <><h2>All caught up</h2><span>Nothing else is due on this table right now.</span></>}
    </> : training.kind === "weakness" ? <>
      <p className="eyebrow">WEAKNESS TRAINER</p>
      <h2>{training.targets?.length ? "Your costliest mistakes" : "Reviews and ordinary hands"}</h2>
      {training.targets?.length ? <span>{training.targets.map(target => gradeLabel(target.bestLabel, familyId ?? "")).join(" · ")}</span>
        : <span>No costly mistakes were found on this table, so hands are due reviews and ordinary deals.</span>}
    </> : <>
      <p className="eyebrow">CLOSE CALLS</p>
      <h2>Best two holds within {number(training.closeCallPerCoin ?? 0.1, 2)} credits per coin</h2>
      <span>The feedback shows how close each one was.</span>
    </>}
  </section>;
}
