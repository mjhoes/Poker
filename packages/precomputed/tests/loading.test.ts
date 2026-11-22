import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { analyzeGame, ENGINE_VERSION, generateStrategyList, registerTrainingAnalysis, standardVariant, STRATEGY_TIERS } from "@perfect-draw/engine";
import { analysisKey, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import {
  deserializeAnalysis, loadPrecomputedAnalysis, loadPrecomputedManifest, serializeAnalysis,
} from "../src";
import type { PrecomputedManifest, SerializedAnalysis } from "../src";
import type { GameAnalysis } from "@perfect-draw/engine";

let analysis: GameAnalysis;
let serialized: SerializedAnalysis;
let compressed: Uint8Array<ArrayBuffer>;
let manifest: PrecomputedManifest;
const table = PAY_TABLE_LIBRARY[0];
const asFetch = (handler: (url: string) => Response | Promise<Response>) =>
  ((url: Parameters<typeof fetch>[0]) => handler(String(url))) as typeof fetch;

beforeAll(() => {
  const vector = standardVariant.valueVector(table, 5, {});
  analysis = analyzeGame(table.familyId, vector, undefined, { betCoins: 5 });
  const key = analysisKey(table.familyId, vector, 5);
  registerTrainingAnalysis(key, analysis);
  const strategies = STRATEGY_TIERS.map(tier => generateStrategyList(key, tier));
  serialized = serializeAnalysis(analysis, table.id, strategies);
  compressed = Uint8Array.from(gzipSync(JSON.stringify(serialized)));
  const sha256 = createHash("sha256").update(compressed).digest("hex");
  manifest = {
    schemaVersion: 3, engineVersion: ENGINE_VERSION, compression: "gzip",
    entries: PAY_TABLE_LIBRARY.map(item => {
      const valueVector = standardVariant.valueVector(item, 5, {});
      const key = analysisKey(item.familyId, valueVector, 5);
      return {
        slug: item.slug, name: item.name, paytableId: item.id, key, file: `${key}.bin`,
        sha256, bytes: compressed.byteLength, familyId: item.familyId, valueVector, betCoins: 5,
        returnPct: analysis.returnPct, variance: analysis.variance,
        hitFreq: analysis.hitFreq, rankProbs: [...analysis.rankProbs],
      };
    }),
  };
}, 60_000);

describe("static analysis loading", () => {
  it("fetches the small manifest without loading any large index", async () => {
    const requests: string[] = [];
    const result = await loadPrecomputedManifest({
      fetch: asFetch(url => { requests.push(url); return Response.json(manifest); }),
    });
    expect(requests).toEqual(["/analyses/manifest.json"]);
    expect(result.entries).toHaveLength(8);
  });

  it("loads and verifies just one gzip index, restoring the complete training map", async () => {
    const requests: string[] = [];
    const loaded = await loadPrecomputedAnalysis(table.slug, manifest, {
      fetch: asFetch(url => { requests.push(url); return new Response(compressed); }),
    });
    expect(requests).toEqual([`/analyses/${serialized.key}.bin`]);
    expect(loaded).toEqual({ ...analysis, strategyLists: serialized.strategyLists });
    // Compression is deterministic, suitable for reproducible content hashes.
    expect(Uint8Array.from(gzipSync(JSON.stringify(serialized)))).toEqual(compressed);
  }, 30_000);

  it("fails explicitly for missing files or corrupt compressed data", async () => {
    await expect(loadPrecomputedManifest({
      fetch: asFetch(() => new Response("", { status: 404 })),
    })).rejects.toThrow(/HTTP 404/);
    await expect(loadPrecomputedAnalysis(table.id, manifest, {
      fetch: asFetch(() => new Response("", { status: 404 })),
    })).rejects.toThrow(/HTTP 404/);
    const damaged = compressed.slice();
    damaged[100] ^= 0xff;
    await expect(loadPrecomputedAnalysis(table.id, manifest, {
      fetch: asFetch(() => new Response(damaged)),
    })).rejects.toThrow(/integrity/);
    await expect(loadPrecomputedAnalysis(table.id, manifest, {
      fetch: asFetch(() => new Response(damaged.slice(1))),
    })).rejects.toThrow(/integrity/);
  });

  it("rejects stale, incomplete, or path-traversal manifests", async () => {
    for (const bad of [
      { ...manifest, engineVersion: "outdated" },
      { ...manifest, entries: manifest.entries.slice(1) },
      { ...manifest, entries: manifest.entries.map(() => manifest.entries[0]) },
      { ...manifest, entries: manifest.entries.map(entry => ({ ...entry, file: "../private" })) },
    ]) {
      await expect(loadPrecomputedManifest({
        fetch: asFetch(() => Response.json(bad)),
      })).rejects.toThrow();
    }
  });

  it("rejects malformed, duplicated, or misweighted per-hand records", () => {
    const copy = () => ({
      ...serialized,
      hands: serialized.hands.map(row => [...row]),
    });
    const wrongWeight = copy();
    wrongWeight.hands[0][1] = wrongWeight.hands[0][1] === 4 ? 12 : 4;
    expect(() => deserializeAnalysis(wrongWeight)).toThrow(/weights/);
    const duplicate = copy();
    duplicate.hands[1] = duplicate.hands[0];
    expect(() => deserializeAnalysis(duplicate)).toThrow(/hand row/);
    expect(() => deserializeAnalysis({ ...serialized, rankProbs: [0.1] })).toThrow(/rank/);
    expect(() => deserializeAnalysis({ ...serialized, returnPct: serialized.returnPct + 0.01 })).toThrow(/summary|strategy lists/);
    expect(() => deserializeAnalysis({ ...serialized, engineVersion: "old" })).toThrow();
  }, 30_000);

  it("accepts measured target misses but rejects stale, mismatched, or over-claimed tiers", () => {
    const altered = (index: number, changes: object) => ({
      ...serialized,
      strategyLists: serialized.strategyLists.map((list, i) => i === index ? { ...list, ...changes } : list),
    });
    const expert = serialized.strategyLists.findIndex(list => list.tier === "Expert");
    const beginner = serialized.strategyLists.findIndex(list => list.tier === "Beginner");
    const reference = serialized.strategyLists.findIndex(list => list.tier === "Reference");
    expect(() => deserializeAnalysis(altered(expert, { analysisKey: "0".repeat(64) }))).toThrow(/strategy lists/);
    expect(() => deserializeAnalysis(altered(expert, {
      costVsOptimal: 0.04, returnPct: serialized.returnPct - 0.04,
    }))).toThrow(/strategy lists/);
    const missed = deserializeAnalysis(altered(expert, {
      costVsOptimal: 0.04, returnPct: serialized.returnPct - 0.04, meetsTarget: false,
    }));
    expect(missed.strategyLists[expert].meetsTarget).toBe(false);
    expect(() => deserializeAnalysis(altered(reference, { optimalDecisionFreq: 0.998 }))).toThrow(/strategy lists/);
    expect(() => deserializeAnalysis(altered(beginner, {
      lines: Array.from({ length: 16 }, (_, rank) => ({ ...serialized.strategyLists[beginner].lines[0], rank })),
    }))).toThrow(/strategy lists/);
    expect(() => deserializeAnalysis({ ...serialized, strategyLists: serialized.strategyLists.slice(1) })).toThrow();
    expect(() => deserializeAnalysis({ ...serialized, schemaVersion: 1 })).toThrow();
  }, 30_000);
});
