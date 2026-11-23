import { useEffect, useId, useRef, useState } from "react";
import type { FeedbackMode, Session } from "@perfect-draw/shared";
import { IconButton, Segmented } from "../components/ui";

const FEEDBACK_MODES: { value: FeedbackMode; label: string; hint: string }[] = [
  { value: "warn_before_draw", label: "Warn before draw", hint: "Pause before the draw when a stronger hold exists" },
  { value: "show_after_draw", label: "Show after draw", hint: "Grade each hand once it is drawn" },
  { value: "silent_report", label: "Silent report", hint: "Hide grades until the session report" },
];

/** Gear on the felt that opens the table's settings. Closes on Escape or a click elsewhere. */
export function TableSettings({ session, busy, onFeedback }: { session: Session; busy: boolean; onFeedback: (mode: FeedbackMode) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); rootRef.current?.querySelector<HTMLElement>("button")?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const active = session.status === "active";
  const mode = session.state.feedbackMode;
  return <div className="table-settings" ref={rootRef}>
    <IconButton icon="settings" tone="on-felt" label="Table settings" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)} />
    {open && <div className="popover" id={panelId} role="group" aria-label="Table settings">
      <p className="popover-title">When to show grades</p>
      {session.mode === "free_play" ? <>
        <Segmented label="Feedback timing" options={FEEDBACK_MODES} value={mode} disabled={!active || busy} onChange={onFeedback} />
        <p className="popover-note">{FEEDBACK_MODES.find(option => option.value === mode)?.hint}. Saved with this session.</p>
      </> : <p className="popover-note">Rapid Drill always grades each hand right away.</p>}
    </div>}
  </div>;
}
