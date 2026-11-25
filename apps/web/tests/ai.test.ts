import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod/v4";
import type { AiProvider } from "@perfect-draw/shared";
import { db, initializeDatabase } from "../src/data/db";
import { costFor, estimateCallCost, formatCost, modelFor } from "../src/ai/models";
import { runTask, setProviderFactory } from "../src/ai/router";
import { aiService, usageService, useAiStore } from "../src/ai/store";
import { AiError } from "../src/ai/types";
import type { LLMProvider, TextRequest } from "../src/ai/types";
import { backupService } from "../src/services/backup";

const schema = z.object({ answer: z.string() });
type Reply = { answer: string } | AiError;

/** A provider that plays back scripted replies and records what it was asked. */
function fakeProviders(script: Partial<Record<AiProvider, Reply[]>>) {
  const calls: { provider: AiProvider; request: TextRequest<unknown> }[] = [];
  setProviderFactory(async (provider): Promise<LLMProvider> => ({
    id: provider,
    async text<T>(request: TextRequest<T>) {
      calls.push({ provider, request: request as TextRequest<unknown> });
      const next = script[provider]?.shift();
      if (!next) throw new AiError("provider", "No scripted reply");
      if (next instanceof AiError) throw next;
      return { data: next as T, model: request.model, inputTokens: 1000, outputTokens: 200 };
    },
    async test() { return { ok: true as const }; },
  }));
  return calls;
}

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
  useAiStore.setState({ keys: {}, settings: null });
  await aiService.load();
});
afterEach(() => setProviderFactory(null));

describe("models and cost", () => {
  it("maps light, medium and heavy to each provider's models", () => {
    expect([modelFor("anthropic", "light").id, modelFor("anthropic", "medium").id, modelFor("anthropic", "heavy").id]).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
    expect([modelFor("openai", "light").id, modelFor("openai", "medium").id, modelFor("openai", "heavy").id]).toEqual(["gpt-6-luna", "gpt-6.2-sol", "gpt-6.2-astra"]);
  });
  it("prices a call from its tokens and estimates one from its text", () => {
    expect(costFor("claude-opus-5-5", 1_000_000, 0)).toBe(4);
    expect(costFor("claude-opus-5-5", 2000, 500)).toBeCloseTo(0.018, 10);
    expect(costFor("gpt-6.2-astra", 2000, 500)).toBeCloseTo(0.036, 10);
    expect(costFor("unknown-model", 2000, 500)).toBe(0);
    expect(estimateCallCost("claude-haiku-5-5", "x".repeat(8000), 1000)).toBeCloseTo((2000 * 0.1 + 1000 * 0.5) / 1e6, 12);
    expect(formatCost(0.0213)).toBe("$0.021");
    expect(formatCost(0.0004)).toBe("<$0.001");
    expect(formatCost(0)).toBe("$0.000");
  });
});

describe("keys", () => {
  it("keeps keys in memory unless remembering is on, and forgetting removes them everywhere", async () => {
    await aiService.setKey("anthropic", "  sk-ant-test  ");
    expect(aiService.keyFor("anthropic")).toBe("sk-ant-test");
    expect(await db.records("aiKeys").count()).toBe(0);
    await aiService.setRemember(true);
    expect((await db.records("aiKeys").get("anthropic"))?.key).toBe("sk-ant-test");
    await aiService.setKey("openai", "sk-openai");
    expect(await db.records("aiKeys").count()).toBe(2);
    // A new session (memory empty) finds remembered keys.
    useAiStore.setState({ keys: {} });
    await aiService.load();
    expect(aiService.keyFor("openai")).toBe("sk-openai");
    await aiService.forgetKey("openai");
    expect(aiService.keyFor("openai")).toBeNull();
    expect(await db.records("aiKeys").get("openai")).toBeUndefined();
    // Turning remembering off deletes stored keys but keeps this session's.
    await aiService.setRemember(false);
    expect(await db.records("aiKeys").count()).toBe(0);
    expect(aiService.keyFor("anthropic")).toBe("sk-ant-test");
    await expect(aiService.setKey("anthropic", "sk ant")).rejects.toThrow("no spaces");
  });
  it("never puts keys in a backup", async () => {
    await aiService.setRemember(true);
    await aiService.setKey("anthropic", "sk-ant-secret");
    const backup = await backupService.export();
    expect(backup).not.toContain("sk-ant-secret");
    expect(JSON.parse(backup).tables.aiKeys).toBeUndefined();
    expect(JSON.parse(backup).tables.aiExplanations).toBeUndefined();
  });
});

describe("running a task", () => {
  const task = (overrides: Partial<Parameters<typeof runTask<{ answer: string }>>[0]> = {}) => runTask({
    task: "test", provider: "anthropic", tier: "heavy", system: "sys", prompt: "question", schema, ...overrides,
  });
  it("asks for an API key when there is none", async () => {
    fakeProviders({});
    await expect(task()).rejects.toMatchObject({ kind: "no_key" });
  });
  it("uses the tier's model, and logs the call with its cost", async () => {
    await aiService.setKey("anthropic", "sk-ant");
    const calls = fakeProviders({ anthropic: [{ answer: "ok" }] });
    const result = await task({ tier: "light" });
    expect(calls[0].request.model).toBe("claude-haiku-5-5");
    expect(result).toMatchObject({ data: { answer: "ok" }, provider: "anthropic", calls: 1, inputTokens: 1000, outputTokens: 200 });
    expect(result.cost).toBeCloseTo(costFor("claude-haiku-5-5", 1000, 200), 12);
    const summary = await usageService.summary();
    expect(summary).toMatchObject({ calls: 1, models: [{ model: "claude-haiku-5-5", calls: 1, inputTokens: 1000, outputTokens: 200 }] });
    await usageService.clear();
    expect((await usageService.summary()).calls).toBe(0);
  });
  it("retries once with the problem explained when a reply fails the check, and counts both calls", async () => {
    await aiService.setKey("anthropic", "sk-ant");
    const calls = fakeProviders({ anthropic: [{ answer: "bad 7" }, { answer: "good" }] });
    const result = await task({ check: data => data.answer.includes("7") ? "It used the number 7, which is not in the data." : null });
    expect(result.data.answer).toBe("good");
    expect(result.calls).toBe(2);
    expect(calls[1].request.prompt).toContain("It used the number 7");
    expect((await usageService.summary()).calls).toBe(2);
  });
  it("gives up after the retry also fails the check", async () => {
    await aiService.setKey("anthropic", "sk-ant");
    fakeProviders({ anthropic: [{ answer: "bad" }, { answer: "bad" }] });
    await expect(task({ check: () => "still wrong" })).rejects.toMatchObject({ kind: "invalid_output", message: "still wrong" });
  });
  it("falls back to the other provider only when that is on and its key exists", async () => {
    await aiService.setKey("anthropic", "sk-ant");
    await aiService.setKey("openai", "sk-oai");
    fakeProviders({ anthropic: [new AiError("rate_limit", "slow down")] });
    await expect(task()).rejects.toMatchObject({ kind: "rate_limit" });
    await aiService.updateSettings({ fallbackEnabled: true });
    const calls = fakeProviders({ anthropic: [new AiError("rate_limit", "slow down")], openai: [{ answer: "from gpt" }] });
    const result = await task();
    expect(result).toMatchObject({ provider: "openai", data: { answer: "from gpt" } });
    expect(calls.map(call => [call.provider, call.request.model])).toEqual([["anthropic", "claude-opus-5-5"], ["openai", "gpt-6.2-astra"]]);
    // A bad key is not worked around by quietly switching provider.
    fakeProviders({ anthropic: [new AiError("auth", "bad key")], openai: [{ answer: "x" }] });
    await expect(task()).rejects.toMatchObject({ kind: "auth" });
  });
  it("logs the tokens a refused call still used", async () => {
    await aiService.setKey("anthropic", "sk-ant");
    fakeProviders({ anthropic: [new AiError("refused", "declined", { model: "claude-opus-5-5", inputTokens: 500, outputTokens: 10 })] });
    await expect(task()).rejects.toMatchObject({ kind: "refused" });
    expect(await usageService.summary()).toMatchObject({ calls: 1, models: [{ inputTokens: 500, outputTokens: 10 }] });
  });
});
