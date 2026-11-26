import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeHandFast, evaluateRule, registerTrainingAnalysis, scoreHeuristic, suggestExceptions } from "@perfect-draw/engine";
import type { HeuristicExample, RuleAST } from "@perfect-draw/engine";
import { analysisKey } from "@perfect-draw/paytables";
import { loadPrecomputedAnalysis, loadPrecomputedManifest } from "@perfect-draw/precomputed";

/*
 * Heuristic cards on the real 9/6 Jacks or Better analysis: the score agrees with the spec's validator, an exception
 * means "hold the other one", and every example and counterexample is true of its cards.
 */
const assets = fileURLToPath(new URL("../../../packages/precomputed/assets/", import.meta.url));
const fromDisk = (async (url: string) => new Response(await readFile(assets + url.split("/").pop()))) as unknown as typeof fetch;
let key = "", values: number[] = [];
beforeAll(async () => {
  const manifest = await loadPrecomputedManifest({ fetch: fromDisk });
  const analysis = await loadPrecomputedAnalysis("jacks-or-better-9-6", manifest, { fetch: fromDisk });
  key = analysisKey(analysis.familyId, analysis.valueVector, analysis.betCoins);
  values = [...analysis.valueVector];
  registerTrainingAnalysis(key, analysis);
}, 60_000);
const rule = (prefer: string, over: string, unless?: RuleAST["unless"]): RuleAST => ({ kind: "prefer", prefer: { label: prefer }, over: { label: over }, ...(unless ? { unless } : {}) });
/** Each example's facts, re-solved from its cards. */
function checkExample(example: HeuristicExample) {
  const solved = analyzeHandFast(example.hand, values, "jacks_or_better");
  const ev = solved.results.find(hold => hold.mask === example.mask)!.ev;
  expect(solved.best.ev - ev).toBeCloseTo(example.evLoss, 9);
  expect(solved.results.find(hold => hold.mask === example.bestMask)!.ev).toBeCloseTo(solved.best.ev, 9);
}

describe("heuristic cards", () => {
  it("score a bare rule the same as the validator, with true examples", () => {
    const score = scoreHeuristic(rule("LP", "4FL"), key);
    const validator = evaluateRule(rule("LP", "4FL"), key);
    expect(score.costPct).toBeCloseTo(validator.costVsOptimal, 10);
    expect(score.costWithoutExceptionsPct).toBeCloseTo(score.costPct, 12);
    expect(score.appliesFreq).toBeCloseTo(validator.realPlayFreq, 12);
    expect(score.rightFreq).toBeLessThan(1);
    expect(score.counterexamples.length).toBeGreaterThan(0);
    score.counterexamples.forEach(checkExample);
    expect(score.counterexamples.every(example => example.evLoss > 0)).toBe(true);
    // The right way round costs nothing, is always right, and its examples are the commonest deals it decides.
    const right = scoreHeuristic(rule("4FL", "LP"), key);
    expect(right.costPct).toBeCloseTo(0, 10);
    expect(right.rightFreq).toBe(1);
    expect(right.examples.length).toBe(3);
    right.examples.forEach(checkExample);
    expect(right.examples.every(example => example.evLoss === 0 && !example.exception)).toBe(true);
    expect(right.examples[0].weight).toBeGreaterThanOrEqual(right.examples[2].weight);
    // Varied: each example holds different ranks.
    const ranks = right.examples.map(example => example.hand.filter((_, index) => example.mask & (1 << index)).map(card => card >> 2).sort().join(","));
    expect(new Set(ranks).size).toBe(ranks.length);
  }, 120_000);
  it("hold the other one when an exception matches: 'A over B unless always' is 'B over A'", () => {
    const always: RuleAST["unless"] = { kind: "or", conditions: [{ kind: "penalty", penalty: "flush" }, { kind: "not", condition: { kind: "penalty", penalty: "flush" } }] };
    const flipped = scoreHeuristic(rule("LP", "4FL", always), key);
    const reverse = scoreHeuristic(rule("4FL", "LP"), key);
    expect(flipped.costPct).toBeCloseTo(reverse.costPct, 10);
    expect(flipped.appliesFreq).toBeCloseTo(reverse.appliesFreq, 12);
    expect(flipped.exceptionFreq).toBeCloseTo(flipped.appliesFreq, 12);
    expect(flipped.costWithoutExceptionsPct).toBeCloseTo(scoreHeuristic(rule("LP", "4FL"), key).costPct, 10);
    // The validator skips those deals instead (its existing meaning).
    expect(evaluateRule(rule("LP", "4FL", always), key).handsAffected).toBe(0);
  }, 120_000);
  it("find exceptions that cut a rule's cost, and none for a rule that's already right", () => {
    const found = suggestExceptions({ prefer: { label: "LP" }, over: { label: "4FL" } }, key);
    expect(found.rule.unless).toBeDefined();
    expect(found.score.costPct).toBeLessThan(found.bare.costPct);
    expect(found.score.costPct).toBeCloseTo(scoreHeuristic(found.rule, key).costPct, 10);
    found.score.examples.filter(example => example.exception).forEach(checkExample);
    const clean = suggestExceptions({ prefer: { label: "4FL" }, over: { label: "LP" } }, key);
    expect(clean.rule.unless).toBeUndefined();
  }, 120_000);
});
