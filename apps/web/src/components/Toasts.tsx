import { useEffect, useRef, useSyncExternalStore } from "react";
import { Icon } from "./Icons";

type ToastTone = "success" | "info" | "error";
export type Toast = { id: number; tone: ToastTone; message: string; action?: { label: string; onClick: () => void } };

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function push(tone: ToastTone, message: string, action?: Toast["action"]) {
  // Collapse an identical message that is already showing instead of stacking duplicates.
  toasts = [...toasts.filter(item => item.message !== message), { id: nextId++, tone, message, action }].slice(-4);
  emit();
}
export function dismissToast(id: number) {
  toasts = toasts.filter(item => item.id !== id);
  emit();
}
export function clearToasts(tone?: ToastTone) {
  toasts = tone ? toasts.filter(item => item.tone !== tone) : [];
  emit();
}
export const toast = {
  success: (message: string, action?: Toast["action"]) => push("success", message, action),
  info: (message: string, action?: Toast["action"]) => push("info", message, action),
  error: (message: string, action?: Toast["action"]) => push("error", message, action),
};

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => toasts;

/** Success and info toasts close themselves; errors stay until dismissed. Hover or focus pauses the timer. */
function ToastItem({ item }: { item: Toast }) {
  const timer = useRef<number | undefined>(undefined);
  const start = () => {
    if (item.tone === "error") return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => dismissToast(item.id), 3500);
  };
  const stop = () => window.clearTimeout(timer.current);
  useEffect(() => { start(); return stop; }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className={`toast toast-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}
    onMouseEnter={stop} onMouseLeave={start} onFocus={stop} onBlur={start}>
    <span className="toast-icon" aria-hidden="true"><Icon name={item.tone === "success" ? "check" : item.tone === "error" ? "warning" : "info"} /></span>
    <span className="toast-message">{item.message}</span>
    {item.action && <button type="button" className="toast-action" onClick={() => { item.action?.onClick(); dismissToast(item.id); }}>{item.action.label}</button>}
    <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(item.id)}><Icon name="x" /></button>
  </div>;
}

export function ToastViewport() {
  const items = useSyncExternalStore(subscribe, snapshot, snapshot);
  return <div className="toast-viewport" aria-live="polite">
    {items.map(item => <ToastItem key={item.id} item={item} />)}
  </div>;
}
