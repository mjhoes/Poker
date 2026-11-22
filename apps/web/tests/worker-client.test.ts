import { afterEach, describe, expect, it, vi } from "vitest";
import { engineClient, resetEngineClient } from "../src/worker/client";

class WorkerStub extends EventTarget {
  static all: WorkerStub[] = [];
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { super(); WorkerStub.all.push(this); }
}
afterEach(() => { resetEngineClient(); vi.unstubAllGlobals(); vi.useRealTimers(); WorkerStub.all = []; });
describe("worker failure recovery", () => {
  it("rejects pending requests on a worker crash and creates a fresh worker for retries", async () => {
    vi.stubGlobal("Worker", WorkerStub);
    const first = engineClient();
    const result = first.loadAnalysis("table");
    const rejected = expect(result).rejects.toThrow(/engine stopped/);
    WorkerStub.all[0].dispatchEvent(new Event("error", { cancelable: true }));
    await rejected;
    expect(WorkerStub.all[0].terminate).toHaveBeenCalledOnce();
    expect(engineClient()).not.toBe(first);
    expect(WorkerStub.all).toHaveLength(2);
  });
  it("cancels in-flight requests when importing a backup resets the engine", async () => {
    vi.stubGlobal("Worker", WorkerStub);
    const result = engineClient().loadAnalysis("table");
    const rejected = expect(result).rejects.toThrow(/reset/);
    resetEngineClient();
    await rejected;
  });
  it("turns a stalled request into a retryable error instead of leaving play busy forever", async () => {
    vi.useFakeTimers(); vi.stubGlobal("Worker", WorkerStub);
    const result = engineClient().loadAnalysis("table");
    const rejected = expect(result).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(180_000);
    await rejected;
    expect(WorkerStub.all[0].terminate).toHaveBeenCalledOnce();
  });
});
