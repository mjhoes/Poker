import { useState } from "react";
import type { FormEvent } from "react";
import { backupService } from "../services/backup";
import { clearToasts, toast } from "../components/Toasts";
import type { ConfirmOptions } from "../components/ConfirmDialog";
import { errorMessage } from "./useActionRunner";
import type { Run } from "./useActionRunner";

const MAX_BACKUP_BYTES = 100_000_000;

export function useBackup({ run, confirm }: { run: Run; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [importing, setImporting] = useState(false);

  async function exportBackup() {
    await run(async () => {
      const text = await backupService.export();
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `perfect-draw-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, { success: "Backup downloaded. Keep a copy somewhere other than this device." });
  }

  async function importBackup(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) { toast.error("That backup is over the 100 MB limit. Nothing was changed."); return; }
    if (!await confirm({
      title: "Restore from this backup?", tone: "danger", icon: "restore", confirmLabel: "Replace my data",
      body: <p>Everything on this device (wallets, machines, sessions and history) will be replaced with the contents of <strong>{file.name}</strong>. Saved API keys are erased. This can't be undone.</p>,
      acknowledge: "I understand this replaces all data on this device.",
    })) return;
    setImporting(true); clearToasts();
    try {
      const result = await backupService.import(await file.text());
      toast.success(`Backup restored: ${result.records} records replaced. Reloading…`);
      // Reload so the engine worker drops caches that belonged to the replaced data.
      window.setTimeout(() => window.location.reload(), 900);
    } catch (reason) { toast.error(errorMessage(reason)); }
    finally { setImporting(false); }
  }

  return { importing, exportBackup: () => void exportBackup(), importBackup: (event: FormEvent<HTMLInputElement>) => void importBackup(event) };
}
