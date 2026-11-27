import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "../Icons";
import type { IconName } from "../Icons";

/** "draw": finishing a hand in progress (Draw, Check answer), a different color and shape from dealing's "gold". */
export type ButtonVariant = "primary" | "secondary" | "gold" | "danger" | "danger-solid" | "draw";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: IconName;
  /** Shows a spinner and disables the button. `loadingLabel` replaces the text while it runs. */
  loading?: boolean;
  loadingLabel?: ReactNode;
};

/** The one button. Variants map onto the existing .btn classes so markup and styling stay in step. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, loading = false, loadingLabel, disabled, className = "", children, type = "button", ...rest }, ref,
) {
  const classes = ["btn", variant === "primary" ? "" : variant, size === "sm" ? "small" : "", loading ? "is-loading" : "", className].filter(Boolean).join(" ");
  return <button ref={ref} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
    {loading ? <span className="btn-spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
    {loading && loadingLabel ? loadingLabel : children}
  </button>;
});

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  /** Accessible name; also shown as the native hover hint. */
  label: string;
  tone?: "plain" | "on-felt";
};

export function IconButton({ icon, label, tone = "plain", className = "", type = "button", ...rest }: IconButtonProps) {
  return <button type={type} className={`icon-button ${tone === "on-felt" ? "on-felt" : ""} ${className}`} aria-label={label} title={label} {...rest}>
    <Icon name={icon} />
  </button>;
}
