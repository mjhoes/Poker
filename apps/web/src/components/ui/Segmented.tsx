import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; hint?: string };

/**
 * A row of mutually exclusive choices. Each option is a toggle button (aria-pressed) inside a labelled group, which
 * reads well to screen readers and keeps every choice one tap away.
 */
export function Segmented<T extends string>({ label, options, value, onChange, disabled }: {
  label: string; options: SegmentedOption<T>[]; value: T; onChange: (value: T) => void; disabled?: boolean;
}) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" className={`segmented-option ${value === option.value ? "selected" : ""}`}
      aria-pressed={value === option.value} title={option.hint} disabled={disabled} onClick={() => onChange(option.value)}>
      {option.label}
    </button>)}
  </div>;
}

export type Swatch<T extends string> = { value: T; label: string; /** Attributes that give the chip its color, e.g. a data-felt. */ chipProps?: Record<string, string> };

/** Radio group of color swatches with names. */
export function SwatchPicker<T extends string>({ label, swatches, value, onChange }: {
  label: string; swatches: Swatch<T>[]; value: T; onChange: (value: T) => void;
}) {
  return <div className="felt-picker" role="radiogroup" aria-label={label}>
    {swatches.map(swatch => <button key={swatch.value} type="button" role="radio" aria-checked={value === swatch.value}
      className={`felt-swatch ${value === swatch.value ? "selected" : ""}`} {...swatch.chipProps} onClick={() => onChange(swatch.value)}>
      <span className="felt-swatch-chip" aria-hidden="true" />
      <span className="felt-swatch-name">{swatch.label}</span>
    </button>)}
  </div>;
}
