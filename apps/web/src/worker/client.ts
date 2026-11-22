import { wrap, proxy } from "comlink";
import type { Remote } from "comlink";
import type { EngineAPI } from "./engine-api";
import type { AnalysisProgress, GameFamilyId, ValueVector } from "@perfect-draw/engine";

let instance: Remote<EngineAPI> | undefined;
let worker: Worker | undefined;
export function engineClient() {
  if (!instance) {
    worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    instance = wrap<EngineAPI>(worker);
  }
  return instance;
}
export function resetEngineClient() { worker?.terminate(); worker = undefined; instance = undefined; }
export function analyzeGameInWorker(family: GameFamilyId, vector: ValueVector, betCoins: number, progress?: (value: AnalysisProgress) => void) {
  return engineClient().analyzeGame(family, vector, betCoins, progress ? proxy(progress) : undefined);
}
