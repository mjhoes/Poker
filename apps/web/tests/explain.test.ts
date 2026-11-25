import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeHandFast, parseHand, standardVariant } from "@perfect-draw/engine";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { db, initializeDatabase } from "../src/data/db";
import { checkNumbers, comparisonKey, explainFacts, factNumbers } from "../src/ai/explain-facts";
import { explainService } from "../src/ai/explain";
import { setProviderFactory } from "../src/ai/router";
import { aiService, usageService, useAiStore } from "../src/ai/store";
import type { LLMProvider, TextRequest } from "../src/ai/types";
import { compareHolds, comparisonSummary } from "../src/table/hold-breakdown";

const table = getLibraryPayTable("jacks-or-better-9-6");
const hand = parseHand("Ah Kh Qh 7h 7c");
const analysis = analyzeHandFast(hand, standardVariant.valueVector(table, 5, {}), table.familyId);
const royalDraw = 0b00111, sevens = 0b11000;
const comparison = compareHolds(analysis, royalDraw, sevens);
const facts = explainFacts({
  hand, gameName: "Jacks or Better", payTableName: table.name, coins: 5,
  best: { mask: royalDraw, name: "3 to a Royal Flush" }, other: { mask: sevens, name: "Low pair", role: "Your hold" },
  comparison, summary: comparisonSummary(comparison, { a: "The best hold", b: "Your hold" }),
});

describe("the facts the model is given", () => {
  it("are the engine's comparison, formatted as the app shows it", () => {
    expect(facts.hand).toEqual(["A♥", "K♥", "Q♥", "7♥", "7♣"]);
    expect(facts.bestHold).toMatchObject({ keep: "A♥ K♥ Q♥", name: "3 to a Royal Flush", possibleDraws: 1081 });
    expect(facts.comparedHold).toMatchObject({ who: "Your hold", keep: "7♥ 7♣" });
    expect(facts.bestHoldIsWorthMoreBy).toBe(comparison.delta.toFixed(3));
    const royal = facts.finalHands.find(row => row.hand === "Royal Flush")!;
    expect(royal).toMatchObject({ paysPerCoinBet: 4000, bestHold: { chance: "1 in 1,081", value: "3.70" }, comparedHold: { chance: "—", value: "0.00" }, deciding: true });
  });
  it("list every number they contain, including card ranks and counts inside names", () => {
    const numbers = factNumbers(facts);
    for (const n of [4000, 1081, 3.7, 7, 3, 5]) expect(numbers).toContain(n);
  });
  it("key a comparison by hand, table, bet and both holds", () => {
    expect(comparisonKey({ hand, paytableId: table.id, coins: 5, bestMask: royalDraw, otherMask: sevens })).toBe(`${hand.join(".")}|${table.id}|5|7|24`);
  });
});

describe("the number check", () => {
  const allowed = factNumbers(facts);
  it("accepts the data's numbers however they are formatted", () => {
    expect(checkNumbers("The royal comes 1 in 1,081 draws (or 1 in 1081) and is worth 3.70, about 3.7 credits.", allowed)).toEqual([]);
    expect(checkNumbers("Keep A♥ K♥ Q♥ rather than the pair of 7s; a royal pays 4,000 at 5 coins.", allowed)).toEqual([]);
  });
  it("rejects a number the data doesn't have, or a whole number rounded from a decimal", () => {
    expect(checkNumbers("The royal comes once in 1,000 draws.", allowed)).toEqual(["1,000"]);
    expect(checkNumbers("That is worth 4 credits.", allowed.filter(n => n !== 4))).toEqual(["4"]);
    expect(checkNumbers("It wins 63% of the time and 63% again.", allowed)).toEqual(["63"]);
  });
});

describe("explaining a comparison", () => {
  const good = { summary: "Keep A♥ K♥ Q♥: the royal draw is worth far more.", why: "A royal comes 1 in 1,081 draws and adds 3.70.", howToRemember: "Three to a royal beats a low pair.", commonMistake: "Holding the pair of 7s because it already pays nothing." };
  let replies: unknown[] = [];
  let prompts: string[] = [];
  beforeEach(async () => {
    await db.transaction("rw", db.tables, async () => { for (const t of db.tables) await t.clear(); });
    await initializeDatabase();
    useAiStore.setState({ keys: {}, settings: null });
    await aiService.load();
    await aiService.setKey("anthropic", "sk-ant");
    replies = []; prompts = [];
    setProviderFactory(async (provider): Promise<LLMProvider> => ({
      id: provider,
      async text<T>(request: TextRequest<T>) {
        prompts.push(request.prompt);
        return { data: replies.shift() as T, model: request.model, inputTokens: 2500, outputTokens: 900 };
      },
      async test() { return { ok: true as const }; },
    }));
  });
  afterEach(() => setProviderFactory(null));
  const key = comparisonKey({ hand, paytableId: table.id, coins: 5, bestMask: royalDraw, otherMask: sevens });

  it("estimates the cost before asking, by tier", () => {
    const light = explainService.estimate(facts, "anthropic", "light"), heavy = explainService.estimate(facts, "anthropic", "heavy");
    expect(light).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(light * 30);
    expect(heavy).toBeLessThan(0.1);
  });
  it("saves a checked explanation with its real cost and finds it again for free", async () => {
    replies.push(good);
    const { record, calls } = await explainService.explain({ key, facts, provider: "anthropic", tier: "heavy" });
    expect(calls).toBe(1);
    expect(record).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", tier: "heavy", inputTokens: 2500, outputTokens: 900, explanation: good });
    expect(record.estCost).toBeCloseTo((2500 * 4 + 900 * 20) / 1e6, 12);
    expect(prompts[0]).toContain("\"chance\": \"1 in 1,081\"");
    expect(await explainService.saved(key, "anthropic", "heavy")).toEqual(record);
    expect(await explainService.saved(key, "anthropic", "light")).toBeNull();
  });
  it("retries when the reply invents a number, then shows nothing if it does again", async () => {
    replies.push({ ...good, why: "A royal comes 1 in 1,000 draws." }, good);
    const { calls } = await explainService.explain({ key, facts, provider: "anthropic", tier: "light" });
    expect(calls).toBe(2);
    expect(prompts[1]).toContain("Numbers not in the DATA: 1,000");
    replies.push({ ...good, why: "Worth 12 credits." }, { ...good, why: "Worth 12 credits." });
    await expect(explainService.explain({ key, facts, provider: "anthropic", tier: "medium" }))
      .rejects.toThrow("The explanation didn't match the engine's numbers, so it isn't shown.");
    expect(await explainService.saved(key, "anthropic", "medium")).toBeNull();
    // Every call that ran was paid for, so all four are in the usage log.
    expect((await usageService.summary()).calls).toBe(4);
  });
});
