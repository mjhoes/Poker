import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "../Icons";

/** Show-more section. Built on <details>, so it works without script and keeps native keyboard behavior. */
export function Disclosure({ summary, children, defaultOpen = false, onToggle, className = "" }: {
  summary: ReactNode; children: ReactNode; defaultOpen?: boolean; onToggle?: (open: boolean) => void; className?: string;
}) {
  return <details className={`disclosure ${className}`} open={defaultOpen || undefined} onToggle={event => onToggle?.(event.currentTarget.open)}>
    <summary><span className="disclosure-chevron" aria-hidden="true"><Icon name="chevron-right" size={15} /></span>{summary}</summary>
    <div className="disclosure-body">{children}</div>
  </details>;
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({ tone = "neutral", dot = false, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="badge-dot" aria-hidden="true" />}{children}</span>;
}

/**
 * Hover and focus hint. The trigger keeps its own semantics; the hint is linked with aria-describedby. Disabled
 * buttons do not receive pointer or focus events, so the wrapper listens instead and is made focusable for them.
 */
export function Tooltip({ text, children, focusable = false, align = "center" }: { text: string; children: ReactNode; focusable?: boolean; align?: "center" | "end" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <span className={`tooltip-anchor ${align === "end" ? "align-end" : ""} ${open ? "open" : ""}`} aria-describedby={id} tabIndex={focusable ? 0 : undefined}
    onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
    {children}
    <span id={id} role="tooltip" className="tooltip">{text}</span>
  </span>;
}
