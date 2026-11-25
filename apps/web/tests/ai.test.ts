import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("review fixes", () => {
  it("never brings back a key forgotten while an earlier load was still reading", async () => {
    await aiService.setRemember(true);
    await aiService.setKey("anthropic", "sk-ant-old");
    useAiStore.setState({ keys: {} }); // a fresh session: the key is only on disk
    // Hold the load just after it has read the stored key, so the forget happens in between (a slow device).
    const table = db.records("aiKeys");
    const original = table.toArray.bind(table);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let reading!: () => void;
    const readDone = new Promise<void>(resolve => { reading = resolve; });
    const spy = vi.spyOn(table, "toArray").mockImplementation((async () => { const rows = await original(); reading(); await gate; return rows; }) as never);
    const load = aiService.load();
    await Promise.race([readDone, new Promise(resolve => setTimeout(resolve, 200))]);
    const forget = aiService.forgetKey("anthropic");
    release();
    await Promise.all([load, forget]);
    spy.mockRestore();
    expect(aiService.keyFor("anthropic")).toBeNull();
    expect(await db.records("aiKeys").get("anthropic")).toBeUndefined();
  });

  it("prices a dated or unknown returned model, never as free", () => {
    expect(costFor("gpt-6.2-astra-2026-05-18", 1000, 0)).toBeCloseTo(costFor("gpt-6.2-astra", 1000, 0), 12);
    expect(costFor("claude-opus-4-8", 1000, 0, "claude-opus-5-5")).toBeCloseTo(costFor("claude-opus-5-5", 1000, 0), 12);
    expect(costFor("gpt-6.2-astra-law", 1000, 0)).toBe(0); // a different model, not a dated version
  });

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const anthropicReply = (text: string) => json({
    id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }],
    stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
  const openAIReply = (text: string) => json({
    id: "resp", object: "response", created_at: 1, status: "completed", model: "gpt-6.2-astra",
    output: [{ type: "message", id: "m", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: 1500, output_tokens: 300, total_tokens: 1800, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  });

  it.each([
    ["anthropic", anthropicReply],
    ["openai", openAIReply],
  ] as const)("keeps the usage of a paid but malformed %s reply and retries it", async (provider, reply) => {
    const { createAnthropicProvider } = await import("../src/ai/anthropic");
    const { createOpenAIProvider } = await import("../src/ai/openai");
    const bodies = [reply("{\"answer\": \"trunc"), reply(JSON.stringify({ answer: "ok" }))];
    const fakeFetch = (async () => bodies.shift()!) as unknown as typeof fetch;
    setProviderFactory(async (id, key) => id === "anthropic" ? createAnthropicProvider(key, { fetch: fakeFetch }) : createOpenAIProvider(key, { fetch: fakeFetch }));
    await aiService.setKey(provider, "sk-test");
    const result = await runTask({ task: "test", provider, tier: "heavy", system: "s", prompt: "p", schema });
    expect(result).toMatchObject({ data: { answer: "ok" }, calls: 2, inputTokens: 3000, outputTokens: 600 });
    expect((await usageService.summary()).calls).toBe(2);
  });

  it("reports a malformed reply's usage even when it is the last try", async () => {
    const { createAnthropicProvider } = await import("../src/ai/anthropic");
    const fakeFetch = (async () => anthropicReply("not json")) as unknown as typeof fetch;
    setProviderFactory(async (_id, key) => createAnthropicProvider(key, { fetch: fakeFetch }));
    await aiService.setKey("anthropic", "sk-test");
    await expect(runTask({ task: "test", provider: "anthropic", tier: "heavy", system: "s", prompt: "p", schema })).rejects.toMatchObject({ kind: "invalid_output" });
    expect(await usageService.summary()).toMatchObject({ calls: 2, models: [{ inputTokens: 3000, outputTokens: 600 }] });
  });
});
