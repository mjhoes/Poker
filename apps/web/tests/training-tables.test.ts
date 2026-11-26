import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
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
