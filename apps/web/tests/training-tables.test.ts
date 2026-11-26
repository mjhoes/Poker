import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { analyzeHand, analyzeHandFast, canonicalizeHand, cardRank, parseHand, standardVariant } from "@perfect-draw/engine";
import type { GameHandResult } from "@perfect-draw/engine";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { loadPrecomputedAnalysis, loadPrecomputedManifest } from "@perfect-draw/precomputed";
import { db, initializeDatabase } from "../src/data/db";
import { StatsEngine } from "../src/worker/stats-engine";

/*
 * Review cards are kept per game family, but a category that is a best hold on one pay table need not be on another of
 * the same game. With the real NSUD and Full-Pay Deuces Wild analyses: the table says which categories it can deal, and
 * a strict (review) target never falls back to an unrelated hand.
 */
const assets = fileURLToPath(new URL("../../../packages/precomputed/assets/", import.meta.url));
const fromDisk = (async (url: string) => new Response(await readFile(assets + url.split("/").pop()))) as unknown as typeof fetch;
const nsud = getLibraryPayTable("deuces-wild-nsud"), fullPay = getLibraryPayTable("deuces-wild-full-pay");
let engine: StatsEngine;
beforeAll(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeDatabase();
  const manifest = await loadPrecomputedManifest({ fetch: fromDisk });
  engine = new StatsEngine(id => loadPrecomputedAnalysis(id, manifest, { fetch: fromDisk }));
}, 60_000);

describe("which review cards a table can deal", () => {
  it("lists a table's best-hold categories: D0_2P is one on NSUD but never on Full-Pay Deuces Wild", async () => {
    expect(await engine.trainableLabels(nsud.id, 5)).toContain("D0_2P");
    const onFullPay = await engine.trainableLabels(fullPay.id, 5);
    expect(onFullPay).not.toContain("D0_2P");
    expect(onFullPay).toContain("D0_HP");
  }, 60_000);
  it("deals the asked-for category, and a strict target refuses rather than deal any other hand", async () => {
    expect((await engine.prepareDeal(nsud.id, 5, { labels: ["D0_2P"], strict: true })).best.label).toBe("D0_2P");
    await expect(engine.prepareDeal(fullPay.id, 5, { labels: ["D0_2P"], strict: true })).rejects.toThrow("isn't a best hold on this table");
    // The Weakness Trainer's targets may still fall back to a real hand.
    expect((await engine.prepareDeal(fullPay.id, 5, { labels: ["D0_2P"] })).best.label).not.toBe("D0_2P");
  }, 60_000);
});

describe("Pay Table Switcher deals", () => {
  it("measures how often two tables' best holds differ, and deals hands where they do", async () => {
    const jacks = getLibraryPayTable("jacks-or-better-9-6"), eightFive = getLibraryPayTable("jacks-or-better-8-5");
    const [{ differPct }] = await engine.switcherDiffer(jacks.id, [eightFive.id], 5);
    expect(differPct).toBeGreaterThan(0.01);
    expect(differPct).toBeLessThan(10);
    expect((await engine.switcherDiffer(nsud.id, [fullPay.id], 5))[0].differPct).toBeGreaterThan(differPct); // deuces tables differ more
    await expect(engine.switcherDiffer(jacks.id, [nsud.id], 5)).rejects.toThrow("same game");
    for (let round = 0; round < 5; round++) {
      const mine = await engine.switcherDeal(jacks.id, [eightFive.id], 5, true);
      const theirs = analyzeHand(mine.hand, standardVariant.valueVector(eightFive, 5, {}), "jacks_or_better");
      // The 9/6 best hold is strictly worse on 8/5 (not a tie).
      expect(theirs.results.find(hold => hold.mask === mine.best.mask)!.ev).toBeLessThan(theirs.best.ev - 1e-9);
    }
  }, 120_000);
});

describe("Pay Table Switcher ties", () => {
  it("doesn't count a deal as different when a third tied hold is best on both tables (PR #10 review)", async () => {
    // Double Double Bonus 9/6 against a same-game table that pays only the royal: on Jc Kd Ah 4s 7s the royal-only
    // table ties J, K and A alone, and its stored result happens to keep J and K; DDB's best is the A alone.
    const ddb = getLibraryPayTable("double-double-bonus-9-6");
    const royalOnly = { ...ddb, pays: Object.fromEntries(Object.entries(ddb.pays).map(([rank, row]) => [rank, rank === "ROYAL_FLUSH" ? row : [0, 0, 0, 0, 0]])) };
    const { id, hand } = canonicalizeHand(parseHand("Jc Kd Ah 4s 7s"));
    const maskOf = (rank: number) => 1 << hand.findIndex(card => cardRank(card) === rank);
    const stored = (values: readonly number[], keep?: [number, number]): GameHandResult => {
      const results = [...analyzeHandFast(hand, values, ddb.familyId).results].sort((a, b) => b.ev - a.ev);
      const [first, second] = keep ? keep.map(mask => results.find(row => row.mask === mask)!) : results;
      return { weight: 1, bestMask: first.mask, secondMask: second.mask, bestLabel: first.label, secondLabel: second.label, ev: first.ev, secondEv: second.ev };
    };
    const royalValues = standardVariant.valueVector(royalOnly as never, 5, {}), ddbValues = standardVariant.valueVector(ddb, 5, {});
    const mine = stored(royalValues, [maskOf(9), maskOf(11)]), theirs = stored(ddbValues);
    expect(theirs.bestMask).toBe(maskOf(12));
    const fixtures = {
      royal: { key: "royal", analysis: { familyId: ddb.familyId, valueVector: royalValues, perHand: new Map([[id, mine]]) } },
      ddb: { key: "ddb", analysis: { familyId: ddb.familyId, valueVector: ddbValues, perHand: new Map([[id, theirs]]) } },
    };
    const switcher = new StatsEngine(async () => { throw new Error("unused"); });
    vi.spyOn(switcher, "game").mockImplementation(async table => fixtures[table as "royal" | "ddb"] as never);
    expect(await switcher.switcherDiffer("royal", ["ddb"], 5)).toEqual([{ paytableId: "ddb", differPct: 0 }]);
  });
});

