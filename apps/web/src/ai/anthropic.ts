import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AiError, parseReply } from "./types";
import type { LLMProvider, TextRequest, TextResult } from "./types";

/*
 * Claude, called straight from the browser with the player's own key. `dangerouslyAllowBrowser` sends the header that
 * lets the API accept a browser request; the flag warns against shipping your own key to browsers, and here the key
 * belongs to the person using the browser (Tech Spec §7.1).
 */
export function createAnthropicProvider(apiKey: string, options: { fetch?: typeof fetch } = {}): LLMProvider {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, ...(options.fetch ? { fetch: options.fetch } : {}) });
  return {
    id: "anthropic",
    async text<T>(request: TextRequest<T>): Promise<TextResult<T>> {
      // Server-side refusal fallback: a declined request is re-run on a fallback model inside the same call. Claude
      // Haiku 5.5 has no server-side fallback, so it is sent without.
      const fallback = request.model === "claude-haiku-5-5" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
      let response;
      try {
        // `create`, not `parse`: the reply is validated below, after its token usage is recorded, so a paid but
        // malformed reply still counts in the usage log and gets the router's retry.
        response = await client.beta.messages.create({
          model: request.model,
          max_tokens: request.maxTokens ?? 16000,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
          output_config: { effort: "medium", format: betaZodOutputFormat(request.schema) },
          ...fallback,
        });
      } catch (error) { throw anthropicError(error); }
      const usage = { model: response.model, inputTokens: inputTokens(response.usage), outputTokens: response.usage.output_tokens };
      if (response.stop_reason === "refusal") throw new AiError("refused", "The model declined to answer this one. Try again, or try another model.", usage);
      if (response.stop_reason === "max_tokens") throw new AiError("invalid_output", "The reply was cut off before it finished.", usage);
      const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("");
      return { data: parseReply(text, request.schema, usage), ...usage };
    },
    async test() {
      try {
        await client.models.list({ limit: 1 });
        return { ok: true as const };
      } catch (error) { return { ok: false as const, error: anthropicError(error).message }; }
    },
  };
}

/** Billed input: uncached input plus cache writes and reads (no caching is set up here, so these are usually zero). */
function inputTokens(usage: { input_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }) {
  return usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

function anthropicError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new AiError("auth", "Anthropic didn't accept this API key. Check it in Settings → AI.");
  if (error instanceof Anthropic.PaymentRequiredError) return new AiError("credit", "Your Anthropic account is out of credit. Add credit in the Anthropic Console.");
  if (error instanceof Anthropic.RateLimitError) return new AiError("rate_limit", "Anthropic is rate limiting this key. Wait a moment and try again.");
  if (error instanceof Anthropic.NotFoundError) return new AiError("provider", "Anthropic doesn't offer this model to your key.");
  if (error instanceof Anthropic.APIConnectionError) return new AiError("network", "Couldn't reach Anthropic. Check your connection and try again.");
  if (error instanceof Anthropic.BadRequestError) return new AiError("provider", `Anthropic rejected the request: ${error.message}`);
  if (error instanceof Anthropic.APIError) return new AiError("provider", `Anthropic had a problem (${error.status ?? "no status"}). Try again shortly.`);
  return new AiError("provider", error instanceof Error ? error.message : String(error));
}
