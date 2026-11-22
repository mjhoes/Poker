import type { Machine, Session } from "@perfect-draw/shared";

export type FeltId = Machine["theme"];
export const FELTS: { id: FeltId; name: string }[] = [
  { id: "felt", name: "Casino green" },
  { id: "midnight", name: "Midnight blue" },
  { id: "classic", name: "Classic burgundy" },
];

/**
 * Appearance is not part of a session's frozen terms: an open session follows its machine's
 * current felt, and falls back to the snapshot if the machine was deleted.
 */
export const feltFor = (session: Session | undefined, machines: Machine[]): FeltId =>
  (session && (machines.find(machine => machine.id === session.machineId)?.theme ?? session.machineSnapshot.theme)) || "felt";

export function FeltPicker({ value, onChange }: { value: FeltId; onChange: (value: FeltId) => void }) {
  return <div className="felt-picker" role="radiogroup" aria-label="Table felt">
    {FELTS.map(felt => <button key={felt.id} type="button" role="radio" aria-checked={value === felt.id}
      className={`felt-swatch ${value === felt.id ? "selected" : ""}`} data-felt={felt.id} onClick={() => onChange(felt.id)}>
      <span className="felt-swatch-chip" aria-hidden="true" />
      <span className="felt-swatch-name">{felt.name}</span>
    </button>)}
  </div>;
}
