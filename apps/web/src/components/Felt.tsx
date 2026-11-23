import { SwatchPicker } from "./ui";
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
  return <SwatchPicker label="Table felt" value={value} onChange={onChange}
    swatches={FELTS.map(felt => ({ value: felt.id, label: felt.name, chipProps: { "data-felt": felt.id } }))} />;
}
