import type { AiProvider, AiTier } from "@perfect-draw/shared";

/*
 * Model IDs and prices are configuration, kept here in one place. Prices are standard per-million-token rates, used only
 * to estimate cost; the provider's own billing is the authority.
 * - Anthropic: current model table (Claude Haiku 5.5, Sonnet 5.5, Opus 5.5).
 * - OpenAI: developers.openai.com/api/docs/models and /pricing, read 2026-11-25 (GPT-6 Luna, GPT-6.2 Sol, GPT-6.2 Astra).
 */
export const PRICES_CHECKED = "2026-11-25";

export interface ModelInfo { id: string; name: string; provider: AiProvider; tier: AiTier; inputPerM: number; outputPerM: number }

export const MODELS: readonly ModelInfo[] = [
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", provider: "anthropic", tier: "light", inputPerM: 0.10, outputPerM: 0.50 },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "anthropic", tier: "medium", inputPerM: 2, outputPerM: 10 },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "anthropic", tier: "heavy", inputPerM: 4, outputPerM: 20 },
  { id: "gpt-6-luna", name: "GPT-6 Luna", provider: "openai", tier: "light", inputPerM: 0.10, outputPerM: 0.50 },
  { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", provider: "openai", tier: "medium", inputPerM: 2, outputPerM: 10 },
  { id: "gpt-6.2-astra", name: "GPT-6.2 Astra", provider: "openai", tier: "heavy", inputPerM: 8, outputPerM: 40 },
];

export const TIERS: readonly { id: AiTier; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "fastest, cheapest" },
  { id: "medium", label: "Medium", hint: "balanced" },
  { id: "heavy", label: "Heavy", hint: "best writing" },
];
export const PROVIDERS: readonly { id: AiProvider; name: string; keyHint: string; keysUrl: string }[] = [
  { id: "anthropic", name: "Anthropic (Claude)", keyHint: "sk-ant-…", keysUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI (GPT)", keyHint: "sk-…", keysUrl: "https://platform.openai.com/api-keys" },
];

export function modelFor(provider: AiProvider, tier: AiTier): ModelInfo {
  return MODELS.find(model => model.provider === provider && model.tier === tier)!;
}
/** The model, also when a provider reports a dated version of it ("gpt-6.2-astra-2026-05-18"). */
export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find(model => model.id === id) ?? MODELS.find(model => id.startsWith(`${model.id}-`) && /^\d/.test(id.slice(model.id.length + 1)));
}
export const providerName = (provider: AiProvider) => PROVIDERS.find(item => item.id === provider)!.name;

/**
 * Dollars for a call. A reply can come from a model not in the table (a provider-side fallback, say); it is then priced
 * as the model that was asked for, never as free. Only a model unknown on both counts prices at zero.
 */
export function costFor(modelId: string, inputTokens: number, outputTokens: number, requestedModelId?: string) {
  const model = modelInfo(modelId) ?? (requestedModelId ? modelInfo(requestedModelId) : undefined);
  return model ? (inputTokens * model.inputPerM + outputTokens * model.outputPerM) / 1_000_000 : 0;
}

/** Rough token count for text about to be sent: about four characters per token for English and JSON. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Estimated cost of one call before it is made: the request's size plus a typical reply. Thinking and reasoning tokens
 * are billed as output, so the reply allowance includes them. Shown as "about"; the real figure comes from the usage.
 */
export function estimateCallCost(modelId: string, requestText: string, typicalOutputTokens: number) {
  return costFor(modelId, estimateTokens(requestText), typicalOutputTokens);
}

/** "$0.021", "<$0.001": costs here are small, so three decimals, never rounded down to zero. */
export function formatCost(dollars: number) {
  if (dollars > 0 && dollars < 0.001) return "<$0.001";
  return `$${dollars.toFixed(dollars < 1 ? 3 : 2)}`;
}
