import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
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
    ]);
    const result = await heuristicsAi.polish(card, facts, { provider: "anthropic", tier: "light", style: "rhyme" });
    expect(sent).toHaveLength(2);
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
