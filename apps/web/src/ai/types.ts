import type { AiProvider } from "@perfect-draw/shared";
import type * as z from "zod/v4";

/** Schemas use Zod 4 (`zod/v4`), which both SDKs' structured-output helpers accept. */
export interface TextRequest<T> { system: string; prompt: string; schema: z.ZodType<T>; model: string; maxTokens?: number }
export interface TextResult<T> { data: T; model: string; inputTokens: number; outputTokens: number }

/** One provider behind a common shape (Tech Spec §7.2). `vision` arrives with photo capture. */
export interface LLMProvider {
  id: AiProvider;
  text<T>(request: TextRequest<T>): Promise<TextResult<T>>;
  /** Checks the key with a free call (the model list); never spends tokens. */
  test(): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type AiErrorKind = "no_key" | "auth" | "rate_limit" | "credit" | "network" | "refused" | "invalid_output" | "provider";

/** A failure with a message fit to show the player. `usage` is set when the failed call still used (and cost) tokens. */
export class AiError extends Error {
  constructor(readonly kind: AiErrorKind, message: string, readonly usage?: { model: string; inputTokens: number; outputTokens: number }) {
    super(message);
    this.name = "AiError";
  }
  /** Failures tied to one provider or moment, where the other provider may succeed. */
  get canFallBack() { return this.kind === "rate_limit" || this.kind === "network" || this.kind === "provider" || this.kind === "refused" || this.kind === "credit"; }
}
