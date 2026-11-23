import { useState } from "react";
import type { FormEvent } from "react";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { Machine, Wallet } from "@perfect-draw/shared";
import { machineDraftSchema } from "@perfect-draw/shared";
import { Field, Modal, familyName, money } from "../components/UiHelpers";
import { FeltPicker } from "../components/Felt";
import { Button, ChoiceChips, Disclosure } from "../components/ui";
import { machineService } from "../services/machines";
import { parseCents } from "../services/money";
import type { Run } from "../hooks/useActionRunner";
import { MachineCabinet } from "../machines/MachineCabinet";
import { defaultMachineName, useLibraryReturns } from "../machines/machine-info";

type MachineForm = {
  name: string; paytableId: string; denomination: string; coins: string; lines: string;
  theme: Machine["theme"]; speed: Machine["speed"];
  defaultWalletId: string; casinoName: string; location: string; notes: string;
};

const DENOMINATIONS = ["0.01", "0.05", "0.25", "1.00", "5.00"] as const;
const denomChipLabel = (value: string) => Number(value) < 1 ? `${Math.round(Number(value) * 100)}¢` : `$${Number(value)}`;
const FAMILIES = [...new Set(PAY_TABLE_LIBRARY.map(table => table.familyId))];

const formFor = (machine: Machine | undefined, wallets: Wallet[]): MachineForm => machine ? {
  name: machine.name, paytableId: machine.paytableId, denomination: (machine.denominationCents / 100).toFixed(2),
  coins: String(machine.coins), lines: String(machine.lines), theme: machine.theme, speed: machine.speed,
  defaultWalletId: machine.defaultWalletId, casinoName: machine.casinoName, location: machine.location, notes: machine.notes,
} : {
  name: "", paytableId: PAY_TABLE_LIBRARY[0]?.id ?? "", denomination: "0.25", coins: "5", lines: "1",
  theme: "felt", speed: "normal", defaultWalletId: wallets[0]?.id ?? "", casinoName: "", location: "", notes: "",
};

/** Form state, validation and save for one machine. A blank name becomes a descriptive default. */
export function useMachineEditor({ machine, wallets, run, onSaved }: {
  machine?: Machine; wallets: Wallet[]; run: Run; onSaved: () => void;
}) {
  const [form, setForm] = useState<MachineForm>(() => formFor(machine, wallets));
  const [error, setError] = useState("");
  const update = <K extends keyof MachineForm>(key: K, value: MachineForm[K]) => setForm(current => ({ ...current, [key]: value }));
  const denominationCents = parseCents(form.denomination);
  const defaultName = defaultMachineName(form.paytableId, denominationCents ?? 25, Number(form.lines));

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!denominationCents || denominationCents > 100000) { setError("Enter a denomination between $0.01 and $1,000.00, with at most two decimal places."); return; }
    if (!form.defaultWalletId || !form.paytableId) { setError("Choose a pay table and a default wallet."); return; }
    const parsed = machineDraftSchema.safeParse({
      name: form.name.trim() || defaultName, paytableId: form.paytableId,
      variant: { kind: "standard", config: {} }, denominationCents,
      coins: Number(form.coins), lines: Number(form.lines),
      theme: form.theme, speed: form.speed, defaultWalletId: form.defaultWalletId,
      casinoName: form.casinoName, location: form.location, notes: form.notes,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the machine settings."); return; }
    await run(async () => {
      await machineService.save(parsed.data, machine?.id);
      onSaved();
    }, { success: machine ? "Machine updated." : "Machine added.", onError: setError });
  }

  return { form, update, error, save, defaultName, denominationCents };
}

export function MachineDialog({ machine, wallets, busy, run, onClose }: {
  machine?: Machine; wallets: Wallet[]; busy: boolean; run: Run; onClose: () => void;
}) {
  const { form, update, error, save, defaultName, denominationCents } = useMachineEditor({ machine, wallets, run, onSaved: onClose });
  const returns = useLibraryReturns();
  const family = PAY_TABLE_LIBRARY.find(table => table.id === form.paytableId)?.familyId ?? FAMILIES[0];
  const tables = PAY_TABLE_LIBRARY.filter(table => table.familyId === family);
  const presetDenomination = DENOMINATIONS.find(value => parseCents(value) === denominationCents);
  const pct = (id: string) => returns.get(id) ? `${returns.get(id)!.toFixed(2)}%` : undefined;

  return <Modal error={error} className="machine-sheet" title={machine ? "Edit machine" : "New machine"} subtitle="Choose a game, a bet and a look. The preview updates as you go." onClose={onClose}>
    <form className="machine-sheet-body" onSubmit={event => void save(event)}>
      <div className="machine-sheet-form">
        <section className="sheet-step">
          <h3><span className="step-number">1</span>Game</h3>
          <ChoiceChips label="Game" variant="tiles" className="family-tiles" value={family} autoFocus
            onChange={next => update("paytableId", PAY_TABLE_LIBRARY.find(table => table.familyId === next)?.id ?? form.paytableId)}
            choices={FAMILIES.map(id => ({ value: id, label: familyName(id), hint: `${PAY_TABLE_LIBRARY.filter(table => table.familyId === id).length} pay table${PAY_TABLE_LIBRARY.filter(table => table.familyId === id).length === 1 ? "" : "s"}` }))} />
          <p className="field-label sheet-sub">Pay table</p>
          <ChoiceChips label="Pay table" value={form.paytableId} onChange={id => update("paytableId", id)}
            choices={tables.map(table => ({ value: table.id, label: table.name, hint: pct(table.id) ? `${pct(table.id)} return` : undefined }))} />
        </section>

        <section className="sheet-step">
          <h3><span className="step-number">2</span>Bet</h3>
          <div className="sheet-row">
            <div className="field"><span className="field-label">Denomination</span>
              <div className="denomination-picker">
                <ChoiceChips label="Denomination" value={presetDenomination ?? ""} onChange={value => update("denomination", value)}
                  choices={DENOMINATIONS.map(value => ({ value, label: denomChipLabel(value) }))} />
                <label className="denomination-other"><span>or $</span><input aria-label="Denomination in dollars" inputMode="decimal" required value={form.denomination} onChange={event => update("denomination", event.target.value)} /></label>
              </div>
            </div>
          </div>
          <div className="sheet-row two">
            <div className="field"><span className="field-label">Coins per hand</span>
              <ChoiceChips label="Coins per hand" value={form.coins} onChange={value => update("coins", value)}
                choices={["1", "2", "3", "4", "5"].map(value => ({ value, label: value, name: `${value} coin${value === "1" ? "" : "s"}` }))} /></div>
            <div className="field"><span className="field-label">Lines</span>
              <ChoiceChips label="Lines" value={form.lines} onChange={value => update("lines", value)}
                choices={["1", "3", "5", "10"].map(value => ({ value, label: value, name: `${value} line${value === "1" ? "" : "s"}` }))} /></div>
          </div>
          {denominationCents ? <p className="sheet-hint">Each hand bets {money(denominationCents * Number(form.coins) * Number(form.lines))}{Number(form.coins) < 5 ? ". Most machines pay a bonus on the royal only at 5 coins." : "."}</p> : null}
        </section>

        <section className="sheet-step">
          <h3><span className="step-number">3</span>Look</h3>
          <FeltPicker value={form.theme} onChange={theme => update("theme", theme)} />
          <p className="field-label sheet-sub">Deal speed</p>
          <ChoiceChips label="Table speed" value={form.speed} onChange={speed => update("speed", speed)}
            choices={[{ value: "relaxed", label: "Relaxed" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Fast" }]} />
        </section>

        <section className="sheet-step">
          <Field label="Name (optional)"><input aria-label="Machine name" maxLength={100} value={form.name} onChange={event => update("name", event.target.value)} placeholder={defaultName} /></Field>
          <Disclosure summary="More details">
            <div className="form-grid">
              <Field label="Default wallet"><select aria-label="Default wallet" required value={form.defaultWalletId} onChange={event => update("defaultWalletId", event.target.value)}>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {money(wallet.balanceCents)}</option>)}</select></Field>
              <Field label="Casino or venue"><input aria-label="Casino or venue" maxLength={120} value={form.casinoName} onChange={event => update("casinoName", event.target.value)} /></Field>
              <Field label="Location"><input aria-label="Location" maxLength={200} value={form.location} onChange={event => update("location", event.target.value)} /></Field>
              <Field label="Notes" full><textarea aria-label="Private notes" maxLength={2000} value={form.notes} onChange={event => update("notes", event.target.value)} /></Field>
            </div>
          </Disclosure>
        </section>
      </div>

      <aside className="machine-sheet-preview">
        <MachineCabinet preview returnPct={returns.get(form.paytableId)} machine={{
          name: form.name.trim() || defaultName, paytableId: form.paytableId, denominationCents: denominationCents ?? 25,
          coins: Number(form.coins), lines: Number(form.lines) as Machine["lines"], theme: form.theme,
        }} />
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} loadingLabel="Saving…">{machine ? "Save changes" : "Add machine"}</Button>
        </div>
      </aside>
    </form>
  </Modal>;
}
