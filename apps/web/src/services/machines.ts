import { machineDraftSchema, machineSchema, nameSchema, newId, uuid } from "@perfect-draw/shared";
import type { MachineService } from "@perfect-draw/shared";
import { db, live, requireRecord, stamp } from "../data/db";

export const machineService: MachineService = {
  async list() { return (await db.records("machines").toArray()).filter(live).map(x => machineSchema.parse(x)); },
  async save(input: unknown, id?: string) {
    const draft = machineDraftSchema.parse(input);
    if (draft.variant.kind !== "standard") throw new Error("Multiplier games are not supported yet.");
    return db.transaction("rw", [db.records("machines"), db.records("paytables"), db.records("wallets")], async () => {
      await requireRecord("paytables", draft.paytableId);
      await requireRecord("wallets", draft.defaultWalletId);
      if (id) await requireRecord("machines", uuid.parse(id));
      const machine = machineSchema.parse({ ...draft, id: id ?? newId(), ...stamp() });
      await db.records("machines").put(machine);
      return machine;
    });
  },
  async remove(id: string) {
    uuid.parse(id);
    return db.transaction("rw", [db.records("machines"), db.records("sessions")], async () => {
      const machine = await requireRecord("machines", id);
      if ((await db.records("sessions").where("machineId").equals(id).toArray()).some(x => live(x) && x.status !== "closed")) {
        throw new Error("Close this machine's sessions before deleting it.");
      }
      await db.records("machines").put({ ...machine, updatedAt: Date.now(), deletedAt: Date.now() });
    });
  },
};
export const validateName = (name: string) => nameSchema.parse(name);
