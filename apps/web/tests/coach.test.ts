import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeContext } from "@perfect-draw/engine";
import type { StatsReportView } from "@perfect-draw/shared";
import type { LLMProvider, TextRequest } from "../src/ai/types";
import { setProviderFactory } from "../src/ai/router";
import { aiService } from "../src/ai/store";
import { coachFacts, coachProblem, coachScope, coachService } from "../src/ai/coach";
import { db, initializeDatabase } from "../src/data/db";
import { backupService } from "../src/services/backup";

/*
 * The AI coach report: facts from the Statistics report only, a reply whose numbers all come from the facts (one retry,
 * then nothing saved), saved with its scope, listed newest first, deleted, and carried by backups (an older backup
 * without reports still restores).
 */
const JACKS = "83f530fb5d825acdb45a83eef831d2dae221a2c455202b6b063d44732d829493";
const report = {
  familyId: "jacks_or_better", coins: 5, n: 240, errors: 31, accuracyPct: 87.0833, evLostPer1000: 61.234, optimalReturnPct: 99.5439,
  asDrilledReturnPct: 98.31, evLostTotal: 14.7,
  categories: [
    { label: "4FL", n: 40, errors: 9, errorRate: 0.2234, avgEvLoss: 0.4123, evLostTotal: 3.7 },
    { label: "LP", n: 60, errors: 4, errorRate: 0.07, avgEvLoss: 0.31, evLostTotal: 1.2 },
    { label: "RF", n: 0, errors: 0, errorRate: 0.5, avgEvLoss: 0, evLostTotal: 0 },
  ],
  confusion: [{ bestLabel: "4FL", chosenLabel: "LP", errors: 7, evLostTotal: 2.9 }, { bestLabel: "LP", chosenLabel: "LP", errors: 0, evLostTotal: 0 }],
  trend: [{ at: Date.UTC(2026, 10, 26), n: 120, errors: 20, accuracyPct: 83.33 }, { at: Date.UTC(2026, 10, 27), n: 120, errors: 11, accuracyPct: 90.83 }],
  context: analyzeContext([]),
} as unknown as StatsReportView;
const scope = coachScope({ paytableId: JACKS, coins: 5, mode: "drill" }, "9/6 Jacks or Better · 5 coins · Rapid Drill");

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
});
afterEach(() => setProviderFactory(null));
function fake(replies: object[]) {
  const sent: string[] = [];
  setProviderFactory(async (provider): Promise<LLMProvider> => ({
    id: provider,
    async text<T>(request: TextRequest<T>) {
      sent.push(request.prompt);
      return { data: request.schema.parse(replies.shift()) as T, model: "claude-test", inputTokens: 2000, outputTokens: 500 };
    },
    async test() { return { ok: true as const }; },
  }));
  return sent;
}

describe("the coach report", () => {
  it("is given the report's own figures: weaknesses with hands seen, confusions with mistakes, the trend and context", () => {
    const facts = coachFacts(report, { payTable: "9/6 Jacks or Better", summary: scope.summary });
    expect(facts).toMatchObject({ game: "Jacks or Better", firstAnswers: 240, mistakes: 31, accuracyPct: 87.1, evLostPer1000Hands: 61.23, optimalReturnPct: 99.544 });
    expect(facts.biggestWeaknesses).toEqual([
      { hand: "4 to a Flush", decisions: 40, mistakes: 9, errorRatePct: 22.3, avgLossPerMistake: 0.412 },
      { hand: "Low pair (Tens or lower)", decisions: 60, mistakes: 4, errorRatePct: 7, avgLossPerMistake: 0.31 },
    ]);
    expect(facts.costliestConfusions).toEqual([{ bestHold: "4 to a Flush", youHeld: "Low pair (Tens or lower)", times: 7, evLostTotal: 2.9 }]);
    expect(facts.recentDays).toEqual([{ day: "2026-11-26", decisions: 120, accuracyPct: 83.3 }, { day: "2026-11-27", decisions: 120, accuracyPct: 90.8 }]);
    expect(facts.whenMistakesHappen).toBe("Not enough recent hands to check (0 of 30).");
  });

  it("only takes replies whose numbers are all in the facts, and of the right shape", () => {
    const facts = coachFacts(report, { payTable: "9/6 Jacks or Better", summary: scope.summary });
    const good = { headline: "Accuracy reached 90.8% on your latest day.", wins: ["Low pairs: 4 mistakes in 60."], focus: ["4 to a Flush: 22.3% wrong."], plan: ["Run the Weakness Trainer."] };
    expect(coachProblem(good, facts)).toBeNull();
    expect(coachProblem({ ...good, headline: "You improved by 7.5 points." }, facts)).toBe("Numbers not in the DATA: 7.5. Use only numbers that appear in the DATA.");
    expect(coachProblem({ ...good, focus: [] }, facts)).toBe("Give 1 to 3 focus items.");
    expect(coachProblem({ ...good, plan: ["a", "b", "c", "d", "e"] }, facts)).toBe("Give 1 to 4 plan steps.");
  });

  it("is written with one retry, saved with its scope, listed newest first and deleted; backups carry it", async () => {
    await aiService.setKey("anthropic", "sk-ant-test-key");
    const facts = coachFacts(report, { payTable: "9/6 Jacks or Better", summary: scope.summary });
    const sent = fake([
      { headline: "Up 7.5 points this week.", wins: [], focus: ["Flush draws."], plan: ["Train."] },
      { headline: "Accuracy reached 90.8% on your latest day.", wins: ["Low pairs are solid."], focus: ["4 to a Flush: 22.3% wrong."], plan: ["Run the Weakness Trainer.", "Make heuristic cards."] },
    ]);
    const { record } = await coachService.write({ scope, facts, provider: "anthropic", tier: "light" });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Numbers not in the DATA: 7.5");
    expect(record).toMatchObject({ scope, report: { headline: "Accuracy reached 90.8% on your latest day.", wins: ["Low pairs are solid."] }, model: "claude-test" });
    expect(record.facts).toEqual(JSON.parse(JSON.stringify(facts)));
    fake([{ headline: "Second report.", wins: [], focus: ["Flush draws."], plan: ["Train."] }]);
    const { record: second } = await coachService.write({ scope, facts, provider: "anthropic", tier: "light" });
    expect((await coachService.list(JACKS, 5)).map(row => row.id)).toEqual([second.id, record.id]);
    expect(await coachService.list(JACKS, 1)).toEqual([]);

    // A report that fails twice is never saved.
    fake([{ headline: "Up 7.5 points.", wins: [], focus: ["x"], plan: ["y"] }, { headline: "Up 7.5 points.", wins: [], focus: ["x"], plan: ["y"] }]);
    await expect(coachService.write({ scope, facts, provider: "anthropic", tier: "light" })).rejects.toThrow("Numbers not in the DATA: 7.5");
    expect(await coachService.list(JACKS, 5)).toHaveLength(2);

    // Backups carry the reports; a backup from before they existed restores with none.
    const text = await backupService.export();
    await backupService.import(text);
    expect((await coachService.list(JACKS, 5)).map(row => row.id)).toEqual([second.id, record.id]);
    const older = JSON.parse(text) as { tables: Record<string, unknown> };
    delete older.tables.coachReports;
    await backupService.import(JSON.stringify(older));
    expect(await coachService.list(JACKS, 5)).toEqual([]);

    // Deleting a report removes it.
    fake([{ headline: "Third report.", wins: [], focus: ["Flush draws."], plan: ["Train."] }]);
    const { record: third } = await coachService.write({ scope, facts, provider: "anthropic", tier: "light" });
    expect((await coachService.list(JACKS, 5)).map(row => row.id)).toEqual([third.id]);
    await coachService.remove(third.id);
    expect(await coachService.list(JACKS, 5)).toEqual([]);
  });
});
