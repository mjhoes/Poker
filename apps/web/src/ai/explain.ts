import * as z from "zod/v4";
import { aiExplanationSchema } from "@perfect-draw/shared";
import type { AiExplanation, AiProvider, AiTier } from "@perfect-draw/shared";
import { db } from "../data/db";
import { checkNumbers, EXPLAIN_PROMPT_VERSION, EXPLAIN_SYSTEM, explainPrompt, explainRetryNote, factNumbers } from "./explain-facts";
import type { ExplainFacts } from "./explain-facts";
import { estimateCallCost, modelFor, modelInfo } from "./models";
import { runTask } from "./router";
import { AiError } from "./types";

const explanationSchema = z.object({
  summary: z.string(), why: z.string(), howToRemember: z.string(), commonMistake: z.string().nullable(),
});
export type Explanation = z.infer<typeof explanationSchema>;

/** Typical reply size in tokens, including thinking or reasoning (billed as output), for the cost estimate. */
const TYPICAL_OUTPUT_TOKENS = 1200;

/** Prefix of the number-check failure, so it can be told apart from other malformed replies. */
const STRAY_NUMBERS = "Numbers not in the DATA: ";
/** Saved under the model that actually wrote it (a fallback may answer for the one asked), so lookups never mix models. */
const savedId = (key: string, provider: AiProvider, model: string) => `v${EXPLAIN_PROMPT_VERSION}|${provider}|${model}|${key}`;
const textOf = (explanation: Explanation) => [explanation.summary, explanation.why, explanation.howToRemember, explanation.commonMistake ?? ""].join(" ");

export const explainService = {
  /** About what one explanation will cost, before asking: the request's size plus a typical reply. */
  estimate(facts: ExplainFacts, provider: AiProvider, tier: AiTier) {
    return estimateCallCost(modelFor(provider, tier).id, EXPLAIN_SYSTEM + explainPrompt(facts), TYPICAL_OUTPUT_TOKENS);
  },
  async saved(key: string, provider: AiProvider, tier: AiTier): Promise<AiExplanation | null> {
    return (await db.records("aiExplanations").get(savedId(key, provider, modelFor(provider, tier).id))) ?? null;
  },
  /** The newest saved explanation of this comparison from any model (viewing it is free, even without a key). */
  async latest(key: string): Promise<AiExplanation | null> {
    const prefix = `v${EXPLAIN_PROMPT_VERSION}|`, suffix = `|${key}`;
    const rows = await db.records("aiExplanations").filter(row => row.id.startsWith(prefix) && row.id.endsWith(suffix)).toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  },
  /**
   * Asks the model, checks every number against the facts (one retry naming the stray numbers), saves the result and
   * returns it with its cost. A reply that still invents numbers is never returned.
   */
  async explain(options: { key: string; facts: ExplainFacts; provider: AiProvider; tier: AiTier }) {
    const allowed = factNumbers(options.facts);
    try {
      const result = await runTask({
        task: "explain_hand", provider: options.provider, tier: options.tier,
        system: EXPLAIN_SYSTEM, prompt: explainPrompt(options.facts), schema: explanationSchema,
        check: data => { const bad = checkNumbers(textOf(data), allowed); return bad.length ? `${STRAY_NUMBERS}${bad.join(", ")}` : null; },
        retryNote: explainRetryNote,
      });
      const now = Date.now();
      const actual = modelInfo(result.model);
      const record = aiExplanationSchema.parse({
        id: savedId(options.key, result.provider, actual?.id ?? result.model), createdAt: now, updatedAt: now, deletedAt: null,
        provider: result.provider, model: result.model, tier: actual?.tier ?? options.tier, promptVersion: EXPLAIN_PROMPT_VERSION,
        explanation: { ...result.data, commonMistake: result.data.commonMistake?.trim() ? result.data.commonMistake : null },
        inputTokens: result.inputTokens, outputTokens: result.outputTokens, estCost: result.cost,
      });
      await db.records("aiExplanations").put(record);
      return { record, calls: result.calls };
    } catch (error) {
      if (error instanceof AiError && error.kind === "invalid_output" && error.message.startsWith(STRAY_NUMBERS)) {
        throw new AiError("invalid_output", "The explanation didn't match the engine's numbers, so it isn't shown. Try again or try another model.");
      }
      throw error;
    }
  },
};
