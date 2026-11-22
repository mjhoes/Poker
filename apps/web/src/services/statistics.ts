import { standardVariant } from "@perfect-draw/engine";
import { analysisKey } from "@perfect-draw/paytables";
import { statsQuerySchema, statsTrainingSchema } from "@perfect-draw/shared";
import type { StatsService } from "@perfect-draw/shared";
import { engineClient } from "../worker/client";
import { requireRecord } from "../data/db";
import { sessionService } from "./sessions";

export const statsService: StatsService = {
  async report(input) {
    const query = statsQuerySchema.parse(input);
    return engineClient().statistics(query);
  },
  async train(input) {
    const { machineId, label } = statsTrainingSchema.parse(input);
    const machine = await requireRecord("machines", machineId);
    const table = await requireRecord("paytables", machine.paytableId);
    const key = analysisKey(table.familyId, standardVariant.valueVector(table, machine.coins, {}), machine.coins);
    const validated = await engineClient().validateTraining(machine.paytableId, machine.coins, label);
    if (validated !== key) throw new Error("Training analysis does not match this machine.");
    return sessionService.start({ machineId, mode: "drill", trainingFocus: { label, analysisKey: key } });
  },
};
