import { wrap, proxy } from "comlink";
import type { EngineAPI } from "./engine-api";
import type { AnalysisProgress, GameFamilyId, ValueVector } from "@perfect-draw/engine";

let instance: EngineAPI | undefined;
let worker: Worker | undefined;
const pending = new Set<(error: Error) => void>();
function disconnect(error: Error) {
  for (const fail of [...pending]) fail(error);
  worker?.terminate(); worker = undefined; instance = undefined;
}
function request<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { pending.delete(fail); clearTimeout(timeout); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const timeout = setTimeout(() => disconnect(new Error("The local engine timed out. Retry this action; your saved hand has not changed.")), 180_000);
    pending.add(fail);
    Promise.resolve().then(work).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export function engineClient() {
  if (!instance) {
    worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    const current = worker;
    worker.addEventListener("error", event => {
      event.preventDefault();
      if (worker === current) disconnect(new Error("The local engine stopped. Retry this action; your saved hand has not changed."));
    });
    worker.addEventListener("messageerror", () => {
      if (worker === current) disconnect(new Error("The local engine response could not be read. Retry this action."));
    });
    const remote = wrap<EngineAPI>(worker);
    const call = <T>(work: () => Promise<T>) => worker === current
      ? request(work) : Promise.reject<T>(new Error("The local engine was reset. Retry this action."));
    instance = {
      rollupDecisions: (...args) => call(() => remote.rollupDecisions(...args)),
      analyzeHand: (...args) => call(() => remote.analyzeHand(...args)),
      analyzeGame: (...args) => call(() => remote.analyzeGame(...args)),
      loadAnalysis: (...args) => call(() => remote.loadAnalysis(...args)),
      previewGame: (...args) => call(() => remote.previewGame(...args)),
      generateDrill: (...args) => call(() => remote.generateDrill(...args)),
      prepareRound: (...args) => call(() => remote.prepareRound(...args)),
      resolveRound: (...args) => call(() => remote.resolveRound(...args)),
      statistics: (...args) => call(() => remote.statistics(...args)),
      validateTraining: (...args) => call(() => remote.validateTraining(...args)),
    };
  }
  return instance;
}
export function resetEngineClient() { disconnect(new Error("The local engine was reset. Retry any pending action.")); }
export function analyzeGameInWorker(family: GameFamilyId, vector: ValueVector, betCoins: number, progress?: (value: AnalysisProgress) => void) {
  return engineClient().analyzeGame(family, vector, betCoins, progress ? proxy(progress) : undefined);
}
