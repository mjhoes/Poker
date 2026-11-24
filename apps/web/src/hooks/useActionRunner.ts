import { useCallback, useRef, useState } from "react";
import { toast } from "../components/Toasts";

export const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export type RunOptions = {
  /** Toast shown after the action succeeds. Leave it out when the screen already shows the result. */
  success?: string;
  /** Where a failure is reported. Defaults to an error toast; dialogs pass their own inline error setter. */
  onError?: (message: string) => void;
};

/**
 * One busy flag for every user action, so a double click or a key repeat can never start two writes at once.
 * `run` resolves to true when the action completed, false when it failed or was skipped because another was running.
 */
export function useActionRunner() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = useCallback(async (action: () => Promise<unknown>, options: RunOptions = {}) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
      if (options.success) toast.success(options.success);
      return true;
    } catch (reason) {
      const message = errorMessage(reason);
      if (options.onError) options.onError(message); else toast.error(message);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  const isBusy = useCallback(() => busyRef.current, []);
  return { busy, run, isBusy };
}

export type ActionRunner = ReturnType<typeof useActionRunner>;
export type Run = ActionRunner["run"];
