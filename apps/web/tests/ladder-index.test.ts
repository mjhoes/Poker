import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chartLineIndex, generateHand, getCanonicalHands, registerTrainingAnalysis } from "@perfect-draw/engine";
import { analysisKey } from "@perfect-draw/paytables";
import { loadPrecomputedAnalysis, loadPrecomputedManifest } from "@perfect-draw/precomputed";

/*
 * The Strategy Ladder's map from deals to chart lines, checked against the real precomputed charts: each line's deals
 * add up to the frequency the chart builder recorded for it, and the ladder deals only hands where the line's hold is
 * a best play.
 */
const assets = fileURLToPath(new URL("../../../packages/precomputed/assets/", import.meta.url));
const fromDisk = (async (url: string) => new Response(await readFile(assets + url.split("/").pop()))) as unknown as typeof fetch;
async function load(slug: string) {
  const manifest = await loadPrecomputedManifest({ fetch: fromDisk });
  const analysis = await loadPrecomputedAnalysis(slug, manifest, { fetch: fromDisk });
  const key = analysisKey(analysis.familyId, analysis.valueVector, analysis.betCoins);
  registerTrainingAnalysis(key, analysis);
  return { key, analysis };
}

describe("chart line index", () => {
  for (const slug of ["jacks-or-better-9-6", "deuces-wild-full-pay"]) {
    it(`matches every line's recorded frequency (${slug})`, async () => {
      const { analysis } = await load(slug);
      const weights = new Map(getCanonicalHands().map(hand => [hand.id, hand.weight]));
      for (const tier of ["Beginner", "Intermediate", "Expert"] as const) {
        const list = analysis.strategyLists.find(item => item.tier === tier)!;
        const index = chartLineIndex(list);
        const totals = new Float64Array(list.lines.length);
        getCanonicalHands().forEach((hand, h) => { totals[index.line[h]] += hand.weight / 2598960; });
        list.lines.forEach((line, i) => expect(totals[i]).toBeCloseTo(line.freq, 9));
        // Dealable hands are those where the chart's hold is a best play; most lines have some.
        for (const ids of index.dealable) for (const id of ids.slice(0, 50)) expect(analysis.perHand.get(id)).toBeDefined();
        const dealt = index.dealable.reduce((sum, ids) => sum + ids.reduce((s, id) => s + weights.get(id)!, 0), 0) / 2598960;
        expect(dealt).toBeCloseTo(list.optimalDecisionFreq, 9);
        expect(index.dealable.filter(ids => ids.length).length).toBeGreaterThan(list.lines.length * 0.8);
      }
    }, 120_000);
  }
  it("deals a line's hand: its best hold is the line's category", async () => {
    const { key, analysis } = await load("jacks-or-better-9-6");
    const list = analysis.strategyLists.find(item => item.tier === "Expert")!;
    const index = chartLineIndex(list);
    const line = index.dealable.findIndex(ids => ids.length > 0 && list.lines[index.dealable.indexOf(ids)].label === "2P");
    expect(line).toBeGreaterThanOrEqual(0);
    const hand = generateHand({ analysisKey: key, onlyIds: index.dealable[line], sampling: "real" });
    expect(index.dealable[line]).toContain(hand.canonicalHandId);
    expect(() => generateHand({ analysisKey: key, onlyIds: [], sampling: "real" })).toThrow();
  }, 120_000);
});
