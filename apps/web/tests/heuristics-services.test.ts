import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { analyzeHandFast, parseHand, resolveRound, standardVariant } from "@perfect-draw/engine";
import type { Hand } from "@perfect-draw/engine";
import { heuristicSchema, newId } from "@perfect-draw/shared";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { loadPrecomputedAnalysis, loadPrecomputedManifest } from "@perfect-draw/precomputed";
import type { LLMProvider, TextRequest } from "../src/ai/types";
import { setProviderFactory } from "../src/ai/router";
import { aiService } from "../src/ai/store";
import { heuristicsAi, polishFacts } from "../src/ai/heuristics-ai";
import { db, initializeDatabase } from "../src/data/db";
import { astToDraft, draftToAst, ruleWords } from "../src/heuristics/rules";
import { heuristicService } from "../src/services/heuristics";
import { machineService } from "../src/services/machines";
import { createPlayService } from "../src/services/play";
import { sessionService } from "../src/services/sessions";
import { graduated } from "../src/training/core";
import { trainingService } from "../src/services/training";
import { walletService } from "../src/services/wallets";
import * as client from "../src/worker/client";
import type { EngineAPI } from "../src/worker/engine-api";
import { StatsEngine } from "../src/worker/stats-engine";

const assets = fileURLToPath(new URL("../../../packages/precomputed/assets/", import.meta.url));
const fromDisk = (async (url: string) => new Response(await readFile(assets + url.split("/").pop()))) as unknown as typeof fetch;
const table = getLibraryPayTable("jacks-or-better-9-6");
let engine: StatsEngine;
beforeAll(async () => {
  const manifest = await loadPrecomputedManifest({ fetch: fromDisk });
  engine = new StatsEngine(id => loadPrecomputedAnalysis(id, manifest, { fetch: fromDisk }));
});
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const item of db.tables) await item.clear(); });
  await initializeDatabase();
  // The real engine, in this process instead of a worker.
  vi.spyOn(client, "engineClient").mockReturnValue({
    heuristicCategories: (...args: Parameters<EngineAPI["heuristicCategories"]>) => engine.heuristicCategories(...args),
    scoreHeuristic: (...args: Parameters<EngineAPI["scoreHeuristic"]>) => engine.scoreHeuristic(...args),
    suggestHeuristic: (...args: Parameters<EngineAPI["suggestHeuristic"]>) => engine.suggestHeuristic(...args),
  } as unknown as EngineAPI);
});
afterEach(() => { vi.restoreAllMocks(); setProviderFactory(null); });
async function machine() {
  const wallet = await walletService.create({ name: "Cards", initialCents: 10_000 });
  return machineService.save({ name: "Jacks", paytableId: table.id, defaultWalletId: wallet.id, denominationCents: 25 });
}

describe("rules in words", () => {
  it("convert between the builder and the engine's rule, and read as a sentence", () => {
    const draft = { prefer: "LP", over: "4FL", unless: [{ type: "rank_held" as const, on: "other" as const, rank: "2" }, { type: "flush_penalty" as const, on: "preferred" as const, rank: null }] };
    const ast = draftToAst(draft);
    expect(ast).toEqual({ kind: "prefer", prefer: { label: "LP" }, over: { label: "4FL" }, unless: { kind: "or", conditions: [
      { kind: "rank", rank: "2", in: "held", on: "over" }, { kind: "penalty", penalty: "flush", on: "preferred" }] } });
    expect(astToDraft(ast)).toEqual(draft);
    expect(draftToAst({ prefer: "4FL|pen:straight", over: "LP", unless: [] }).prefer).toEqual({ label: "4FL|pen:straight", match: "exact" });
    expect(() => draftToAst({ prefer: "LP", over: "LP", unless: [] })).toThrow("different");
    const words = ruleWords(ast, "jacks_or_better");
    expect(words.rule).toBe("Hold low pair (Tens or lower) over 4 to a Flush.");
    expect(words.exceptions).toEqual([
      "When 4 to a Flush includes a 2, hold 4 to a Flush instead.",
      "When keeping low pair (Tens or lower) means throwing away a card of its suit (a flush penalty), hold 4 to a Flush instead.",
    ]);
  });
});

describe("cards", () => {
  it("are made from your costliest mistakes, scored by the engine, and remade in place", async () => {
    const { id } = await machine();
    vi.spyOn(trainingService, "weaknessTargets").mockResolvedValue([
      { bestLabel: "4FL", chosenLabel: "LP", weight: 2 },
      { bestLabel: "HP", chosenLabel: "HP", weight: 1 }, // which cards to keep: not a rule between two holds
    ]);
    const first = await heuristicService.fromMistakes(id);
    expect([first.made.length, first.skipped, first.targets]).toEqual([1, 1, 2]);
    const [card] = first.made;
    expect(card).toMatchObject({ paytableId: table.id, coins: 5, source: "engine", targetLabelPair: ["4FL", "LP"], status: "active", mnemonic: "" });
    expect(card.ruleText).toBe("Hold 4 to a Flush over low pair (Tens or lower).");
    expect(card.costPct).toBeCloseTo(0, 10);
    expect(card.rightFreq).toBe(1);
    expect(card.examples.length).toBeGreaterThan(0);
    // Archived cards stay archived; making cards again updates the same card.
    await heuristicService.setStatus(card.id, "archived");
    const again = await heuristicService.fromMistakes(id);
    expect(again.made[0]).toMatchObject({ id: card.id, status: "archived" });
    expect(await heuristicService.cards()).toHaveLength(1);
  }, 120_000);
  it("made from your mistakes leave a Rule Lab card for the same holds as you wrote it", async () => {
    const { id } = await machine();
    const lab = await heuristicService.saveFromLab(id, { prefer: "4FL", over: "LP", unless: [{ type: "rank_held", on: "other", rank: "2" }] });
    vi.spyOn(trainingService, "weaknessTargets").mockResolvedValue([{ bestLabel: "4FL", chosenLabel: "LP", weight: 2 }]);
    const { made: [engineCard] } = await heuristicService.fromMistakes(id);
    expect(engineCard.id).not.toBe(lab.id);
    expect(engineCard.source).toBe("engine");
    const again = await heuristicService.fromMistakes(id);
    expect(again.made[0].id).toBe(engineCard.id); // the engine's card is the one remade
    const cards = await heuristicService.cards();
    expect(cards).toHaveLength(2);
    expect(cards.find(card => card.id === lab.id)).toEqual(lab);
  }, 120_000);
  it("from the Rule Lab are scored and saved", async () => {
    const { id } = await machine();
    const card = await heuristicService.saveFromLab(id, { prefer: "LP", over: "4FL", unless: [{ type: "rank_held", on: "other", rank: "2" }] });
    expect(card).toMatchObject({ source: "lab", targetLabelPair: ["LP", "4FL"] });
    expect(card.exceptions).toHaveLength(1);
    expect(card.costPct).toBeLessThan(card.costWithoutExceptionsPct);
    expect(card.counterexamples.length).toBeGreaterThan(0);
  }, 120_000);
});

describe("AI polish and plain English", () => {
  const fake = (replies: object[]) => {
    const sent: string[] = [];
    setProviderFactory(async (provider): Promise<LLMProvider> => ({
      id: provider,
      async text<T>(request: TextRequest<T>) {
        sent.push(request.prompt);
        return { data: request.schema.parse(replies.shift()) as T, model: "claude-test", inputTokens: 1000, outputTokens: 300 };
      },
      async test() { return { ok: true as const }; },
    }));
    return sent;
  };
  it("rewords a card with a mnemonic, retrying a reply that invents numbers or drops the exception", async () => {
    await aiService.setKey("anthropic", "sk-ant-test-key");
    const { id } = await machine();
    const card = await heuristicService.saveFromLab(id, { prefer: "LP", over: "4FL", unless: [{ type: "rank_held", on: "other", rank: "2" }] });
    const facts = polishFacts(card, { familyId: "jacks_or_better", game: "Jacks or Better", payTable: table.name, style: "rhyme" });
    expect(facts.exceptions).toHaveLength(1);
    const sent = fake([
      { ruleText: "Keep the low pair over 4 to a flush, it wins 73% of the time.", exceptions: ["If the flush has a 2, go for the flush."], mnemonic: "Pairs stay, flushes play" },
      { ruleText: "Keep the low pair over 4 to a flush.", exceptions: ["If the flush draw holds a 2, keep the flush draw."], mnemonic: "Pairs stay put,\nbut a 2 says flush." },
      // Reading the words back gives the card's own rule.
      { understood: true, prefer: "LP", over: "4FL", unless: [{ type: "rank_held", on: "other", rank: "2" }], note: null },
    ]);
    const result = await heuristicsAi.polish(card, facts, { provider: "anthropic", tier: "light", style: "rhyme" });
    expect(sent).toHaveLength(3);
    expect(sent[2]).toContain("RULE:\nKeep the low pair over 4 to a flush. If the flush draw holds a 2, keep the flush draw.");
    expect(sent[1]).toContain("Numbers not in the DATA: 73");
    expect(result.card).toMatchObject({ ruleText: "Keep the low pair over 4 to a flush.", mnemonicStyle: "rhyme", aiModel: "claude-test" });
    expect(result.card.ruleAst).toEqual(card.ruleAst); // the rule and its costs stay the engine's
    expect(result.card.costPct).toBe(card.costPct);
    // A reply that drops the exception twice is never saved.
    const again = fake([
      { ruleText: "Keep the pair.", exceptions: [], mnemonic: "Pairs stay" },
      { ruleText: "Keep the pair.", exceptions: [], mnemonic: "Pairs stay" },
    ]);
    await expect(heuristicsAi.polish(result.card, facts, { provider: "anthropic", tier: "light", style: "rhyme" })).rejects.toThrow("exactly 1 exception");
    expect(again[1]).toContain("exactly 1 exception");
    expect((await heuristicService.cards())[0].ruleText).toBe("Keep the low pair over 4 to a flush.");
  }, 120_000);
  it("never saves words that mean another rule: a changed rank, a condition on the other hold, or the preference turned round", async () => {
    await aiService.setKey("anthropic", "sk-ant-test-key");
    const { id } = await machine();
    // 4 to a Flush over a low pair, unless the pair includes a 2.
    const card = await heuristicService.saveFromLab(id, { prefer: "4FL", over: "LP", unless: [{ type: "rank_held", on: "other", rank: "2" }] });
    const facts = polishFacts(card, { familyId: "jacks_or_better", game: "Jacks or Better", payTable: table.name, style: "phrase" });
    const options = { provider: "anthropic" as const, tier: "light" as const, style: "phrase" as const };
    const good = { ruleText: "Keep 4 to a flush over a low pair.", exceptions: ["If the low pair is 2s, keep the pair."], mnemonic: "Flush first, but 2s stay" };
    const readsAs = (prefer: string, over: string, on: "preferred" | "other", rank = "2") => ({ understood: true, prefer, over, unless: [{ type: "rank_held", on, rank }], note: null });
    const words = async () => (await heuristicService.cards()).find(row => row.id === card.id)!;

    // A changed rank (an Ace for a 2, with no number in sight) fails the check before anything is read back.
    let sent = fake([
      { ...good, exceptions: ["When the pair includes an Ace, hold the pair instead."] },
      { ...good, exceptions: ["When the pair includes an Ace, hold the pair instead."] },
    ]);
    await expect(heuristicsAi.polish(card, facts, options)).rejects.toThrow("Ranks not in the DATA's rule: Ace");
    expect(sent).toHaveLength(2);
    expect((await words()).ruleText).toBe("Hold 4 to a Flush over low pair (Tens or lower).");

    // The condition moved to the other hold: read back, it's another rule, so the AI is told and tries again.
    sent = fake([
      { ...good, exceptions: ["If the flush draw has a 2, keep the pair."] }, readsAs("4FL", "LP", "preferred"),
      good, readsAs("4FL", "LP", "other"),
    ]);
    const fixed = await heuristicsAi.polish(card, facts, options);
    expect(sent).toHaveLength(4);
    expect(sent[2]).toContain("Your last wording reads as a different rule: \"Hold 4 to a Flush over low pair (Tens or lower). When 4 to a Flush includes a 2, hold low pair (Tens or lower) instead.\"");
    expect(fixed.card.exceptions).toEqual(["If the low pair is 2s, keep the pair."]);
    expect(fixed.calls).toBe(4);

    // The preference turned round, twice: nothing is saved over the words the card has.
    sent = fake([
      { ...good, ruleText: "Keep a low pair over 4 to a flush." }, readsAs("LP", "4FL", "preferred"),
      { ...good, ruleText: "Keep a low pair over 4 to a flush." }, readsAs("LP", "4FL", "preferred"),
    ]);
    await expect(heuristicsAi.polish(fixed.card, facts, options)).rejects.toThrow("read as a different rule");
    expect(sent).toHaveLength(4);
    expect((await words()).ruleText).toBe("Keep 4 to a flush over a low pair.");
    expect((await words()).ruleAst).toEqual(card.ruleAst);
  }, 120_000);
  it("turns a rule in plain English into the builder's fields, only from the table's categories", async () => {
    await aiService.setKey("anthropic", "sk-ant-test-key");
    const categories = [{ code: "LP", name: "Low pair" }, { code: "4FL", name: "4 to a Flush" }];
    const sent = fake([
      { understood: true, prefer: "FLUSH_DRAW", over: "LP", unless: [], note: null },
      { understood: true, prefer: "4FL", over: "LP", unless: [{ type: "rank_held", on: "other", rank: "3" }], note: null },
    ]);
    const { draft } = await heuristicsAi.parse("Four to a flush beats a low pair unless it's threes", categories, { provider: "anthropic", tier: "light" });
    expect(sent[1]).toContain("prefer must be one of the CATEGORIES codes");
    expect(draft).toEqual({ prefer: "4FL", over: "LP", unless: [{ type: "rank_held", on: "other", rank: "3" }] });
    fake([{ understood: false, prefer: null, over: null, unless: [], note: "That describes a bet, not a hold." }]);
    await expect(heuristicsAi.parse("Bet max always", categories, { provider: "anthropic", tier: "light" })).rejects.toThrow("That describes a bet, not a hold.");
  });
});

describe("mastery on cards", () => {
  /** A stored card whose best hold is `label` on the 9/6 Jacks machine's table. */
  async function stored(label: string) {
    const now = Date.now();
    const card = heuristicSchema.parse({
      id: newId(), createdAt: now, updatedAt: now, deletedAt: null, paytableId: table.id, coins: 5, source: "lab", targetLabelPair: [label, "LP"],
      ruleAst: draftToAst({ prefer: label, over: "LP", unless: [] }), ruleText: `Hold ${label} over LP.`, mnemonic: "", exceptions: [], examples: [],
      costPct: 0, status: "active",
    });
    await db.records("heuristicCards").put(card);
    return card;
  }
  const row = (familyId: string, label: string, alpha: number, beta = 1) => ({
    id: newId(), updatedAt: Date.now(), deletedAt: null, familyId, label, alpha, beta, lastSeenAt: Date.now(), fsrsStability: 5, fsrsDifficulty: 5,
    dueAt: Date.now() + 86_400_000, evLostTotal: 0, reps: 3, lapses: 0, lastReviewedAt: Date.now(),
  });
  const mastery = async () => heuristicService.mastery(await heuristicService.cards());

  it("comes from Train's cards in the card's own game only", async () => {
    expect([graduated({ alpha: 50, beta: 1 }), graduated({ alpha: 49, beta: 1 })]).toEqual([true, false]);
    const card = await stored("4FL");
    // Mastered in Bonus Poker Deluxe only: not mastered at Jacks or Better.
    await db.table("categoryMastery").put(row("bonus_poker_deluxe", "4FL", 50));
    expect((await mastery()).get(card.id)).toBeUndefined();
    // Still learning it at Jacks or Better, with the other game's card graduated: still not.
    await db.table("categoryMastery").put(row("jacks_or_better", "4FL", 20));
    expect((await mastery()).get(card.id)).toBeUndefined();
    // Graduated at Jacks or Better (a variant of the category counts as the same kind).
    await db.table("categoryMastery").clear();
    await db.table("categoryMastery").bulkPut([row("jacks_or_better", "4FL", 50), row("jacks_or_better", "4FL|pen:straight", 60), row("bonus_poker_deluxe", "4FL", 20)]);
    expect((await mastery()).get(card.id)).toBe("mastered");
  });

  it("stays out of sight while an open quiet session holds answers for it, and shows when the session closes", async () => {
    const hand = parseHand("Ah Kh Qh Jh 2c"); // best: 4 to a Royal Flush
    const play = createPlayService(() => ({
      prepareRound: async (_id: string, coins: number) => ({
        analysis: analyzeHandFast(hand, standardVariant.valueVector(table, coins, {})),
        drawDecks: [Array.from({ length: 52 }, (_, i) => i).filter(card => !hand.includes(card))],
      }),
      resolveRound: async (dealt: Hand, mask: number, decks: number[][], _id: string, coins: number) =>
        resolveRound(dealt, mask, decks, table.familyId, standardVariant.valueVector(table, coins, {})),
    }) as never);
    const { id: machineId } = await machine();
    const card = await stored("4RF");
    await db.table("categoryMastery").put(row("jacks_or_better", "4RF", 49));
    expect((await mastery()).get(card.id)).toBeUndefined();
    // Answered right in a quiet Free Play session that stays open: the answer is recorded, its result not shown.
    const quiet = await sessionService.start({ machineId, mode: "free_play", feedbackMode: "silent_report" });
    const dealt = await play.deal(quiet.id, quiet.state.handId);
    await sessionService.applyAction(quiet.id, { type: "hold", heldMask: 0b01111, handId: dealt.state.handId });
    await play.submit(quiet.id, dealt.state.handId!);
    const [answered] = await trainingService.cards();
    expect(graduated(answered)).toBe(true);
    expect((await mastery()).get(card.id)).toBe("hidden");
    await sessionService.close(quiet.id);
    expect((await mastery()).get(card.id)).toBe("mastered");
  }, 60_000);
});
