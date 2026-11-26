import { useEffect, useRef } from "react";
import { IconButton } from "./ui/Button";
import type { ReactNode } from "react";

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const credits = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.floor(value));
export const creditLabel = (state: { credits: number; creditRemainderCents?: number }) =>
  `${credits(state.credits)} credits${state.creditRemainderCents ? ` + ${money(state.creditRemainderCents)}` : ""}`;
export const dateTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
const FAMILY_NAMES: Record<string, string> = {
  jacks_or_better: "Jacks or Better", bonus_poker: "Bonus Poker", bonus_poker_deluxe: "Bonus Poker Deluxe",
  double_bonus: "Double Bonus", double_double_bonus: "Double Double Bonus", deuces_wild: "Deuces Wild",
};
const titleCase = (id: string) => id.toLowerCase().split("_").filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
export const familyName = (id: string) => FAMILY_NAMES[id] ?? titleCase(id);
const HAND_RANK_NAMES: Record<string, string> = {
  ROYAL_FLUSH: "Royal Flush", NATURAL_ROYAL: "Natural Royal", WILD_ROYAL: "Wild Royal", FOUR_DEUCES: "Four Deuces",
  FIVE_KIND: "Five of a Kind", STRAIGHT_FLUSH: "Straight Flush", FOUR_KIND: "Four of a Kind",
  FOUR_ACES: "Four Aces", FOUR_234: "Four 2s, 3s or 4s", FOUR_5K: "Four 5s–Ks",
  FOUR_ACES_W_234: "Four Aces + 2, 3 or 4", FOUR_234_W_A234: "Four 2s–4s + A, 2, 3 or 4",
  FULL_HOUSE: "Full House", FLUSH: "Flush", STRAIGHT: "Straight", THREE_KIND: "Three of a Kind",
  TWO_PAIR: "Two Pair", JACKS_OR_BETTER: "Jacks or Better", NOTHING: "No win",
};
export const handRankName = (id: string) => HAND_RANK_NAMES[id] ?? titleCase(id);
export const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
export const modeName = (mode: string) => ({ drill: "Rapid Drill", free_play: "Free Play" } as Record<string, string>)[mode] ?? mode.replaceAll("_", " ");
/** A session's mode as players know it: a Free Play session with pace settings is a Casino pace session. */
export const sessionModeName = (session: { mode: string; pace?: unknown }) => session.pace ? "Casino pace" : modeName(session.mode);

export function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return <label className={`field ${full ? "full" : ""}`}><span className="field-label">{label}</span>{children}</label>;
}

export function Modal({ title, subtitle, onClose, children, error, className = "" }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; error?: string; className?: string;
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
    const preferred = dialog?.querySelector<HTMLElement>("[data-autofocus]");
    (preferred ?? firstFormControl ?? focusable()?.[0])?.focus();

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
    <section ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1}>
      <div className="modal-head"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon="x" label="Close dialog" onClick={() => onCloseRef.current()} /></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {children}
    </section>
  </div>;
}
