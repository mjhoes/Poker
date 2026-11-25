import { newId, uploadSchema } from "@perfect-draw/shared";
import type { AiProvider, AiTier } from "@perfect-draw/shared";
import { db } from "../data/db";
import { costFor, estimateTokens, modelFor, modelInfo } from "../ai/models";
import { runTask } from "../ai/router";
import { HAND_PROMPT, HAND_SYSTEM, handProblem, handReplySchema } from "./hand-photo";
import type { HandReply } from "./hand-photo";
import { imageTokens } from "./image";
import type { PreparedImage } from "./image";
import { PAYTABLE_PROMPT, PAYTABLE_SYSTEM, paytableReplySchema } from "./paytable-photo";
import type { PaytableReply } from "./paytable-photo";

export type PhotoKind = "paytable" | "hand";
type Reply<K extends PhotoKind> = K extends "paytable" ? PaytableReply : HandReply;

/** Typical reply sizes in tokens, including thinking or reasoning (billed as output), for the estimate. */
const TYPICAL_OUTPUT = { paytable: 2000, hand: 700 } as const;
const TASK = { paytable: "paytable_extract", hand: "hand_extract" } as const;
const CACHE_DAYS = 90;

interface CachedRead { fingerprint: string; model: string; reply: unknown; cost: number }

export const photoService = {
  /** About what reading this photo will cost with a model size: the image's tokens, the instructions, a typical reply. */
  estimate(kind: PhotoKind, image: Pick<PreparedImage, "width" | "height">, provider: AiProvider, tier: AiTier) {
    const system = kind === "paytable" ? PAYTABLE_SYSTEM + PAYTABLE_PROMPT : HAND_SYSTEM + HAND_PROMPT;
    return costFor(modelFor(provider, tier).id, imageTokens(provider, image.width, image.height) + estimateTokens(system) + 300, TYPICAL_OUTPUT[kind]);
  },
  /** A previous read of the same photo with the same model, kept on the device (without the photo). */
  async cached<K extends PhotoKind>(kind: K, fingerprint: string, model: string): Promise<{ reply: Reply<K>; cost: number } | null> {
    const rows = await db.records("uploads").where("expiresAt").above(Date.now()).toArray().catch(() => []);
    const hit = rows.find(row => row.kind === kind && (row.extracted as CachedRead)?.fingerprint === fingerprint && (row.extracted as CachedRead).model === model);
    return hit ? { reply: (hit.extracted as CachedRead).reply as Reply<K>, cost: 0 } : null;
  },
  /**
   * Reads a photo: from the device if this photo was read before with this model (free), otherwise from the provider
   * (schema-checked, one retry if a hand isn't five different cards). The photo itself is never stored.
   */
  async read<K extends PhotoKind>(kind: K, image: PreparedImage, provider: AiProvider, tier: AiTier) {
    const model = modelFor(provider, tier).id;
    const saved = await this.cached(kind, image.fingerprint, model);
    if (saved) return { reply: saved.reply, cached: true as const, cost: 0, calls: 0, model, provider };
    const sent = { base64: image.base64, mediaType: image.mediaType }; // only the pixels: no preview URL or fingerprint
    const result = kind === "paytable"
      ? await runTask({ task: TASK.paytable, provider, tier, system: PAYTABLE_SYSTEM, prompt: PAYTABLE_PROMPT, schema: paytableReplySchema, image: sent })
      : await runTask({ task: TASK.hand, provider, tier, system: HAND_SYSTEM, prompt: HAND_PROMPT, schema: handReplySchema, image: sent, check: handProblem });
    const now = Date.now();
    const servedModel = modelInfo(result.model)?.id ?? result.model;
    await db.records("uploads").put(uploadSchema.parse({
      id: newId(), kind, confirmed: false, provider: result.provider, model: servedModel, createdAt: now, updatedAt: now, deletedAt: null,
      expiresAt: now + CACHE_DAYS * 86_400_000,
      extracted: { fingerprint: image.fingerprint, model: servedModel, reply: result.data, cost: result.cost } satisfies CachedRead,
    }));
    return { reply: result.data as Reply<K>, cached: false as const, cost: result.cost, calls: result.calls, model: result.model, provider: result.provider };
  },
};
