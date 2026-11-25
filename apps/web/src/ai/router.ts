import type { AiProvider, AiTier } from "@perfect-draw/shared";
import type * as z from "zod/v4";
import { costFor, modelFor } from "./models";
import { aiService, usageService, useAiStore } from "./store";
import { AiError } from "./types";
import type { LLMProvider } from "./types";

/** Providers are loaded on first use, so the SDKs never weigh on app start. Tests swap in fakes. */
type ProviderFactory = (provider: AiProvider, apiKey: string) => Promise<LLMProvider>;
const defaultFactory: ProviderFactory = async (provider, apiKey) => provider === "anthropic"
  ? (await import("./anthropic")).createAnthropicProvider(apiKey)
  : (await import("./openai")).createOpenAIProvider(apiKey);
let factory = defaultFactory;
export function setProviderFactory(next: ProviderFactory | null) { factory = next ?? defaultFactory; }
export function getProvider(provider: AiProvider) {
  const key = aiService.keyFor(provider);
  if (!key) throw new AiError("no_key", "Add an API key in Settings → AI to use this.");
  return factory(provider, key);
}

export interface TaskResult<T> {
  data: T; provider: AiProvider; model: string; inputTokens: number; outputTokens: number; cost: number;
  /** Provider calls made, including a retry or a fallback; all of them are in the cost. */ calls: number;
}

/**
 * Runs one AI task: the chosen provider at the chosen tier, a schema-checked reply, one retry when the reply is malformed
 * or fails `check` (told what was wrong), and the other provider when fallback is on, its key exists and the failure is
 * one it could avoid. Every call that used tokens is logged with its estimated cost.
 */
export async function runTask<T>(options: {
  task: string; provider: AiProvider; tier: AiTier; system: string; prompt: string; schema: z.ZodType<T>;
  /** Returns a description of what is wrong with a schema-valid reply, or null when it is acceptable. */
  check?: (data: T) => string | null;
  retryNote?: (problem: string) => string;
}): Promise<TaskResult<T>> {
  const fallbackEnabled = useAiStore.getState().settings?.fallbackEnabled ?? false;
  const order: AiProvider[] = [options.provider];
  const other: AiProvider = options.provider === "anthropic" ? "openai" : "anthropic";
  if (fallbackEnabled && aiService.keyFor(other)) order.push(other);
  const totals = { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
  let lastError: AiError | null = null;

  for (const provider of order) {
    let client: LLMProvider;
    try { client = await getProvider(provider); } catch (error) { lastError = asAiError(error); continue; }
    const model = modelFor(provider, options.tier).id;
    let prompt = options.prompt;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await client.text({ system: options.system, prompt, schema: options.schema, model });
        await record(provider, options.task, result, totals, model);
        const problem = options.check?.(result.data) ?? null;
        if (!problem) return { data: result.data, provider, model: result.model, ...totals };
        lastError = new AiError("invalid_output", problem);
        prompt = `${options.prompt}\n\n${options.retryNote ? options.retryNote(problem) : `Your previous reply had a problem: ${problem} Please fix it.`}`;
      } catch (error) {
        const failure = asAiError(error);
        if (failure.usage) await record(provider, options.task, failure.usage, totals, model);
        lastError = failure;
        if (failure.kind === "invalid_output" && attempt === 1) continue; // one more try with the same provider
        break;
      }
    }
    if (lastError && !lastError.canFallBack && lastError.kind !== "no_key") break;
  }
  throw lastError ?? new AiError("provider", "The AI request failed.");
}

async function record(provider: AiProvider, task: string, usage: { model: string; inputTokens: number; outputTokens: number }, totals: { inputTokens: number; outputTokens: number; cost: number; calls: number }, requestedModel: string) {
  totals.calls++;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.cost += costFor(usage.model, usage.inputTokens, usage.outputTokens, requestedModel);
  await usageService.log({ provider, model: usage.model, task, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, requestedModel).catch(() => undefined);
}

function asAiError(error: unknown) {
  return error instanceof AiError ? error : new AiError("provider", error instanceof Error ? error.message : String(error));
}
