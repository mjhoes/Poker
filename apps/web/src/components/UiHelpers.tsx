import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const credits = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
export const dateTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
export const familyName = (id: string) => id.replaceAll("_", " ");
export const modeName = (mode: string) => ({ drill: "Rapid Drill", free_play: "Free Play" } as Record<string, string>)[mode] ?? mode.replaceAll("_", " ");

export function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return <label className={`field ${full ? "full" : ""}`}><span className="field-label">{label}</span>{children}</label>;
}

export function Modal({ title, subtitle, onClose, children, error }: {
  title: string; subtitle: string; onClose: () => void; children: ReactNode; error: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="file"]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    const firstFormControl = dialog?.querySelector<HTMLElement>(
      'input:not([disabled]):not([type="file"]), select:not([disabled]), textarea:not([disabled])',
    );
    (firstFormControl ?? focusable()?.[0])?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(focusable() ?? []).filter(item => item.getClientRects().length > 0);
      if (!items.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
    <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1}>
      <div className="modal-head"><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button type="button" className="close-btn" aria-label="Close dialog" onClick={() => onCloseRef.current()}>×</button></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {children}
    </section>
  </div>;
}
