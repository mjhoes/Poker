import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type Choice<T extends string> = { value: T; label: ReactNode; /** Accessible name when the visible label is terse, e.g. "3" → "3 lines". */ name?: string; hint?: ReactNode; disabled?: boolean };

/**
 * A radio group drawn as chips or tiles. Arrow keys move the selection, as with native radios; only the selected
 * chip is in the tab order.
 */
export function ChoiceChips<T extends string>({ label, choices, value, onChange, variant = "chips", className = "", autoFocus = false }: {
  label: string; choices: Choice<T>[]; value: T; onChange: (value: T) => void; variant?: "chips" | "tiles"; className?: string;
  /** Marks the selected chip as a dialog's first focus target (see Modal's data-autofocus). */ autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = choices.filter(choice => !choice.disabled);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const order = enabled.map(choice => choices.indexOf(choice));
    const next = order[(order.indexOf(index) + step + order.length) % order.length];
    onChange(choices[next].value);
    refs.current[next]?.focus();
  };
  const selectedIndex = Math.max(0, choices.findIndex(choice => choice.value === value));
  return <div className={`choice-group is-${variant} ${className}`} role="radiogroup" aria-label={label}>
    {choices.map((choice, index) => <button key={choice.value} ref={node => { refs.current[index] = node; }} type="button" role="radio"
      aria-checked={choice.value === value} aria-label={choice.name} tabIndex={index === selectedIndex ? 0 : -1} disabled={choice.disabled}
      data-autofocus={autoFocus && index === selectedIndex ? "" : undefined}
      className={`choice ${choice.value === value ? "selected" : ""}`} onClick={() => onChange(choice.value)} onKeyDown={event => onKeyDown(event, index)}>
      <span className="choice-label">{choice.label}</span>
      {choice.hint && <span className="choice-hint">{choice.hint}</span>}
    </button>)}
  </div>;
}
