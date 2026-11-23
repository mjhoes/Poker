import { useState } from "react";
import type { FormEvent } from "react";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { Machine, Wallet } from "@perfect-draw/shared";
import { machineDraftSchema } from "@perfect-draw/shared";
import { Field, Modal, money } from "../components/UiHelpers";
import { FeltPicker } from "../components/Felt";
import { machineService } from "../services/machines";
import { parseCents } from "../services/money";
import type { Run } from "../hooks/useActionRunner";

type MachineForm = {
  name: string; paytableId: string; denomination: string; coins: string; lines: string;
  theme: Machine["theme"]; speed: Machine["speed"];
  defaultWalletId: string; casinoName: string; location: string; notes: string;
};

const formFor = (machine: Machine | undefined, wallets: Wallet[]): MachineForm => machine ? {
  name: machine.name, paytableId: machine.paytableId, denomination: (machine.denominationCents / 100).toFixed(2),
  coins: String(machine.coins), lines: String(machine.lines), theme: machine.theme, speed: machine.speed,
  defaultWalletId: machine.defaultWalletId, casinoName: machine.casinoName, location: machine.location, notes: machine.notes,
} : {
  name: "", paytableId: PAY_TABLE_LIBRARY[0]?.id ?? "", denomination: "0.25", coins: "5", lines: "1",
  theme: "felt", speed: "normal", defaultWalletId: wallets[0]?.id ?? "", casinoName: "", location: "", notes: "",
};

/** Form state, validation and save for one machine. Kept apart from the markup so the Phase 4 sheet can reuse it. */
export function useMachineEditor({ machine, wallets, run, onSaved }: {
  machine?: Machine; wallets: Wallet[]; run: Run; onSaved: () => void;
}) {
  const [form, setForm] = useState<MachineForm>(() => formFor(machine, wallets));
  const [error, setError] = useState("");
  const update = <K extends keyof MachineForm>(key: K, value: MachineForm[K]) => setForm(current => ({ ...current, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const denominationCents = parseCents(form.denomination);
    if (!denominationCents || denominationCents > 100000) { setError("Enter a denomination between $0.01 and $1,000.00, with at most two decimal places."); return; }
    if (!form.name.trim() || !form.defaultWalletId || !form.paytableId) { setError("Name, paytable, and default wallet are required."); return; }
    const parsed = machineDraftSchema.safeParse({
      name: form.name.trim(), paytableId: form.paytableId,
      variant: { kind: "standard", config: {} }, denominationCents,
      coins: Number(form.coins), lines: Number(form.lines),
      theme: form.theme, speed: form.speed, defaultWalletId: form.defaultWalletId,
      casinoName: form.casinoName, location: form.location, notes: form.notes,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the machine configuration."); return; }
    await run(async () => {
      await machineService.save(parsed.data, machine?.id);
      onSaved();
    }, { success: machine ? "Machine updated." : "Machine added.", onError: setError });
  }

  return { form, update, error, save };
}

export function MachineDialog({ machine, wallets, busy, run, onClose }: {
  machine?: Machine; wallets: Wallet[]; busy: boolean; run: Run; onClose: () => void;
}) {
  const { form, update, error, save } = useMachineEditor({ machine, wallets, run, onSaved: onClose });
  return <Modal error={error} title={machine ? "Edit machine" : "New machine"} subtitle="Pick the game, pay table and bet you want to practice." onClose={onClose}>
    <form onSubmit={event => void save(event)}>
      <div className="form-grid">
        <Field label="Machine name"><input aria-label="Machine name" required maxLength={100} value={form.name} onChange={event => update("name", event.target.value)} placeholder="e.g. Main practice table" /></Field>
        <Field label="Pay table"><select aria-label="Paytable library" required value={form.paytableId} onChange={event => update("paytableId", event.target.value)}>{PAY_TABLE_LIBRARY.map(table => <option key={table.id} value={table.id}>{table.name}</option>)}</select></Field>
        <Field label="Denomination (USD)"><input aria-label="Denomination in dollars" inputMode="decimal" required value={form.denomination} onChange={event => update("denomination", event.target.value)} /></Field>
        <Field label="Coins per hand"><select aria-label="Coins per hand" value={form.coins} onChange={event => update("coins", event.target.value)}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} coin{value === 1 ? "" : "s"}</option>)}</select></Field>
        <Field label="Lines"><select aria-label="Lines" value={form.lines} onChange={event => update("lines", event.target.value)}>{[1, 3, 5, 10].map(value => <option key={value} value={value}>{value} line{value === 1 ? "" : "s"}</option>)}</select></Field>
        <div className="field full"><span className="field-label">Table felt</span><FeltPicker value={form.theme} onChange={theme => update("theme", theme)} /></div>
        <Field label="Table speed"><select aria-label="Table speed" value={form.speed} onChange={event => update("speed", event.target.value as MachineForm["speed"])}><option value="relaxed">Relaxed</option><option value="normal">Normal</option><option value="fast">Fast</option></select></Field>
        <Field label="Default wallet"><select aria-label="Default wallet" required value={form.defaultWalletId} onChange={event => update("defaultWalletId", event.target.value)}>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {money(wallet.balanceCents)}</option>)}</select></Field>
        <Field label="Casino or venue (optional)"><input aria-label="Casino or venue" maxLength={120} value={form.casinoName} onChange={event => update("casinoName", event.target.value)} /></Field>
        <Field label="Location (optional)"><input aria-label="Location" maxLength={200} value={form.location} onChange={event => update("location", event.target.value)} /></Field>
        <Field label="Notes (optional)" full><textarea aria-label="Private notes" maxLength={2000} value={form.notes} onChange={event => update("notes", event.target.value)} /></Field>
      </div>
      <div className="form-actions"><button className="btn secondary" type="button" onClick={onClose}>Cancel</button><button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : machine ? "Save changes" : "Save configuration"}</button></div>
    </form>
  </Modal>;
}
