import { useState } from "react";
import type { FormEvent } from "react";
import type { Paytable } from "@perfect-draw/shared";
import { Field, Modal } from "../components/UiHelpers";
import { Button } from "../components/ui";
import { toast } from "../components/Toasts";
import type { Run } from "../hooks/useActionRunner";
import { PayTableEditor } from "../paytables/PayTableEditor";
import { PayTablePhotoFlow } from "../photo/PayTablePhotoFlow";
import type { PaytableInfo } from "../paytables/catalog";
import { paytableService } from "../services/paytables";
import type { SaveResult } from "../services/paytables";

/** Toast for a save, including when the pays turned out to match a table that already exists. */
export function announceSave(result: SaveResult) {
  if (result.matched === "library") toast.info(`These pays match the built-in ${result.name}, so that table is used.`);
  else if (result.matched === "custom") toast.info(`You already saved these pays as “${result.name}”.`);
  else toast.success(`Pay table “${result.name}” saved.`);
}

export function PayTableDialog({ startFrom, busy, run, onClose }: { startFrom?: PaytableInfo; busy: boolean; run: Run; onClose: () => void }) {
  return <Modal className="paytable-sheet" title="Enter a pay table" subtitle="Type the pays printed on the machine. The engine computes the exact return as you go." onClose={onClose}>
    <PayTableEditor startFrom={startFrom} busy={busy} run={run} onCancel={onClose} onSaved={result => { announceSave(result); onClose(); }} />
  </Modal>;
}

/** A pay table from a photo of the machine: read, confirm, save, then see its return and strategy difference. */
export function PayTablePhotoDialog({ busy, run, onClose }: { busy: boolean; run: Run; onClose: () => void }) {
  return <Modal className="paytable-sheet" title="Pay table from a photo" subtitle="The AI reads the photo; the app checks the numbers and you confirm before anything is saved." onClose={onClose}>
    <PayTablePhotoFlow busy={busy} run={run} onCancel={onClose} onSaved={announceSave} onDone={onClose} />
  </Modal>;
}

export function RenamePaytableDialog({ table, busy, run, onClose }: { table: Paytable; busy: boolean; run: Run; onClose: () => void }) {
  const [name, setName] = useState(table.name);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    await run(async () => { await paytableService.rename(table.id, name); onClose(); }, { success: "Pay table renamed.", onError: setError });
  }
  return <Modal error={error} title="Rename pay table" onClose={onClose}>
    <form onSubmit={event => void save(event)}>
      <Field label="Name"><input aria-label="Pay table name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
      <div className="form-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingLabel="Saving…">Save name</Button></div>
    </form>
  </Modal>;
}
