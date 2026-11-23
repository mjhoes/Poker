import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../Icons";
import type { IconName } from "../Icons";

export type MenuItem = { label: string; icon?: IconName; tone?: "danger"; disabled?: boolean; onSelect: () => void };

/**
 * "⋯" actions menu following the WAI-ARIA menu button pattern: Enter/Space/↓ opens it on the first item, arrow keys
 * move, Escape or Tab closes it, and focus returns to the button.
 */
export function MenuButton({ label, items, tone = "plain" }: { label: string; items: MenuItem[]; tone?: "plain" | "on-felt" }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusItem = (index: number) => {
    const enabled = items.map((item, i) => item.disabled ? -1 : i).filter(i => i >= 0);
    if (!enabled.length) return;
    const target = enabled[(enabled.indexOf(index) + enabled.length) % enabled.length] ?? enabled[0];
    itemRefs.current[target]?.focus();
  };
  const close = (returnFocus = true) => { setOpen(false); if (returnFocus) buttonRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    focusItem(items.findIndex(item => !item.disabled));
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onMenuKey = (event: ReactKeyboardEvent) => {
    const current = itemRefs.current.findIndex(item => item === document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(current + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(current - 1 < 0 ? items.length - 1 : current - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusItem(items.length - 1); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === "Tab") close(false);
  };

  return <div className="menu" ref={rootRef}>
    <button ref={buttonRef} type="button" className={`icon-button ${tone === "on-felt" ? "on-felt" : ""}`} aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
      <Icon name="more" />
    </button>
    {open && <div className="menu-list" id={menuId} role="menu" aria-label={label} onKeyDown={onMenuKey}>
      {items.map((item, index) => <button key={item.label} ref={node => { itemRefs.current[index] = node; }} type="button" role="menuitem"
        className={`menu-item ${item.tone === "danger" ? "is-danger" : ""}`} disabled={item.disabled} tabIndex={-1}
        onClick={() => { close(false); item.onSelect(); }}>
        {item.icon && <Icon name={item.icon} size={16} />}{item.label}
      </button>)}
    </div>}
  </div>;
}
