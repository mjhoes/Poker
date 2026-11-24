import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./UiHelpers";
import { Icon } from "./Icons";
import type { IconName } from "./Icons";

export type ConfirmOptions = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  icon?: IconName;
  /** When set, the confirm button stays disabled until this statement is checked. */
  acknowledge?: string;
};

function ConfirmDialog({ options, onResult }: { options: ConfirmOptions; onResult: (value: boolean) => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const danger = options.tone === "danger";
  return <Modal title={options.title} onClose={() => onResult(false)} className={`confirm-dialog ${danger ? "is-danger" : ""}`}>
    <div className="confirm-body">
      {options.icon && <span className="confirm-icon" aria-hidden="true"><Icon name={options.icon} size={22} /></span>}
      <div className="confirm-copy">{options.body}</div>
    </div>
    {options.acknowledge && <label className="confirm-ack">
      <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
      <span>{options.acknowledge}</span>
    </label>}
    <div className="form-actions">
      {/* Danger dialogs focus Cancel first so Enter or Space never confirms by accident. */}
      <button className="btn secondary" type="button" data-autofocus={danger && !options.acknowledge ? "" : undefined} onClick={() => onResult(false)}>{options.cancelLabel ?? "Cancel"}</button>
      <button className={`btn ${danger ? "danger-solid" : ""}`} type="button" data-autofocus={!danger ? "" : undefined}
        disabled={!!options.acknowledge && !acknowledged} onClick={() => onResult(true)}>{options.confirmLabel}</button>
    </div>
  </Modal>;
}

/** Promise-based replacement for window.confirm: `if (!await confirm({...})) return;` */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOptions(next);
  }), []);
  const finish = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);
  const dialog = options ? <ConfirmDialog key={options.title} options={options} onResult={finish} /> : null;
  return { confirm, dialog };
}
