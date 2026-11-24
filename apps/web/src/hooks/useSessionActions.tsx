import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedbackMode, Session } from "@perfect-draw/shared";
import { sessionService } from "../services/sessions";
import { playService } from "../services/play";
import { money } from "../components/UiHelpers";
import type { ConfirmOptions } from "../components/ConfirmDialog";
import type { ActionRunner } from "./useActionRunner";

/**
 * Everything the session room can do. Play actions report failures inline on the table (with a retry of the last
 * action); session-level actions (switch, pause, resume, close) use the normal toast path.
 */
export function useSessionActions({ runner, confirm, shownSessionId, onShowSession, onOpenRoom }: {
  runner: ActionRunner;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  shownSessionId: string | undefined;
  /** Show a specific session in the room (null shows the active one). */
  onShowSession: (id: string | null) => void;
  onOpenRoom: () => void;
}) {
  const { run, isBusy } = runner;
  const [playError, setPlayError] = useState("");
  const retryRef = useRef<(() => Promise<unknown>) | null>(null);

  useEffect(() => { setPlayError(""); retryRef.current = null; }, [shownSessionId]);

  const runPlay = useCallback(async (action: () => Promise<unknown>, remember = true) => {
    if (isBusy()) return;
    if (remember) retryRef.current = action;
    setPlayError("");
    await run(action, { onError: setPlayError });
  }, [run, isBusy]);

  const activate = useCallback(async (id: string) => {
    onShowSession(null);
    await run(async () => { await sessionService.activate(id); onOpenRoom(); });
  }, [run, onShowSession, onOpenRoom]);

  const changeStatus = useCallback(async (action: "pause" | "resume" | "close", session: Session) => {
    if (action === "close") {
      const { hands, netCents, errors } = session.summary;
      const ok = await confirm({
        title: "Close this session?", icon: "door", confirmLabel: "Close session",
        body: <>
          <dl className="confirm-summary">
            <div><dt>Hands</dt><dd>{hands.toLocaleString()}</dd></div>
            {session.mode === "free_play" && <div><dt>Net</dt><dd className={netCents < 0 ? "negative" : "positive"}>{money(netCents)}</dd></div>}
            <div><dt>Mistakes</dt><dd>{errors.toLocaleString()}</dd></div>
          </dl>
          <p>You'll get the full session report, and it stays in your history.</p>
        </>,
      });
      if (!ok) return;
    }
    const fn = action === "pause" ? sessionService.pause : action === "resume" ? sessionService.resume : sessionService.close;
    await run(async () => {
      await fn(session.id);
      if (action === "close") onShowSession(session.id);
    });
  }, [run, confirm, onShowSession]);

  return {
    playError,
    activate,
    pause: (session: Session) => void changeStatus("pause", session),
    resume: (session: Session) => void changeStatus("resume", session),
    close: (session: Session) => void changeStatus("close", session),
    retryPlay: () => { const retry = retryRef.current; if (retry) void runPlay(retry, false); },
    toggleHeld: (session: Session, index: number) => void runPlay(() =>
      sessionService.applyAction(session.id, { type: "hold", heldMask: session.state.heldMask ^ (1 << index), handId: session.state.handId })),
    setHeldMask: (session: Session, heldMask: number) => void runPlay(() =>
      sessionService.applyAction(session.id, { type: "hold", heldMask, handId: session.state.handId })),
    deal: (session: Session) => void runPlay(() => playService.deal(session.id, session.state.handId)),
    submit: (session: Session, confirmMistake = false) => {
      const handId = session.state.handId;
      if (handId) void runPlay(() => playService.submit(session.id, handId, confirmMistake));
    },
    setFeedback: (session: Session, feedbackMode: FeedbackMode) => void runPlay(() =>
      sessionService.applyAction(session.id, { type: "feedback", feedbackMode })),
  };
}
