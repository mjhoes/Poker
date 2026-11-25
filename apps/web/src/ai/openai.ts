import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { AiError, parseReply } from "./types";
import type { LLMProvider, TextRequest, TextResult } from "./types";

/** GPT, called straight from the browser with the player's own key (Responses API, structured output from a Zod schema). */
export function createOpenAIProvider(apiKey: string, options: { fetch?: typeof fetch } = {}): LLMProvider {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, ...(options.fetch ? { fetch: options.fetch } : {}) });
  return {
    id: "openai",
    async text<T>(request: TextRequest<T>): Promise<TextResult<T>> {
      let response;
      try {
        // `create`, not `parse`: usage is recorded before the reply is validated (see the Anthropic provider).
        response = await client.responses.create({
          model: request.model,
          instructions: request.system,
          input: request.prompt,
          max_output_tokens: request.maxTokens ?? 16000,
          reasoning: { effort: "medium" },
          text: { format: zodTextFormat(request.schema, "result") },
        });
      } catch (error) { throw openAIError(error); }
      const usage = { model: response.model, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 };
      const refused = response.output.some(item => item.type === "message" && item.content.some(part => part.type === "refusal"));
      if (refused) throw new AiError("refused", "The model declined to answer this one. Try again, or try another model.", usage);
      if (response.status === "incomplete") throw new AiError("invalid_output", "The reply was cut off before it finished.", usage);
      const text = response.output.flatMap(item => item.type === "message" ? item.content.flatMap(part => part.type === "output_text" ? [part.text] : []) : []).join("");
      return { data: parseReply(text, request.schema, usage), ...usage };
    },
    async test() {
      try {
        await client.models.list();
        return { ok: true as const };
      } catch (error) { return { ok: false as const, error: openAIError(error).message }; }
    },
  };
}

function openAIError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) return new AiError("auth", "OpenAI didn't accept this API key. Check it in Settings → AI.");
  if (error instanceof OpenAI.RateLimitError) {
    return error.code === "insufficient_quota"
      ? new AiError("credit", "Your OpenAI account is out of credit. Add credit in the OpenAI dashboard.")
      : new AiError("rate_limit", "OpenAI is rate limiting this key. Wait a moment and try again.");
  }
  if (error instanceof OpenAI.NotFoundError) return new AiError("provider", "OpenAI doesn't offer this model to your key.");
  if (error instanceof OpenAI.APIConnectionError) return new AiError("network", "Couldn't reach OpenAI. Check your connection and try again.");
  if (error instanceof OpenAI.BadRequestError) return new AiError("provider", `OpenAI rejected the request: ${error.message}`);
  if (error instanceof OpenAI.APIError) return new AiError("provider", `OpenAI had a problem (${error.status ?? "no status"}). Try again shortly.`);
  return new AiError("provider", error instanceof Error ? error.message : String(error));
}
