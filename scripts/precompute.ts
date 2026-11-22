import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { analyzeGame, clearEvaluatorCache, clearSubsetCache, clearTrainingCache, describeLabel, ENGINE_VERSION, generateStrategyList, registerTrainingAnalysis, standardVariant, STRATEGY_TIERS, strategyExceptionCount } from "../packages/engine/src/index";
import type { StrategyList } from "../packages/engine/src/index";
import { analysisKey, PAY_TABLE_LIBRARY } from "../packages/paytables/src/index";
import { deserializeAnalysis, manifestSchema, serializeAnalysis } from "../packages/precomputed/src/format";
import type { PrecomputedManifest } from "../packages/precomputed/src/format";

const output = resolve("packages/precomputed/assets");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function assertLibraryTargets(slug: string, lists: readonly StrategyList[]): void {
  for (const list of lists) {
    const required = list.tier === "Reference" || list.tier === "Beginner" || list.tier === "Expert";
    if (required && !list.meetsTarget) throw new Error(`${slug} ${list.tier} misses its library target: ${list.costVsOptimal} pp`);
  }
}

async function verify(): Promise<void> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8")));
  for (const table of PAY_TABLE_LIBRARY) {
    const entry = manifest.entries.find(item => item.slug === table.slug);
    if (!entry || entry.paytableId !== table.id) throw new Error(`Missing/stale asset: ${table.slug}`);
    const compressed = await readFile(resolve(output, entry.file));
    if (compressed.byteLength !== entry.bytes || digest(compressed) !== entry.sha256) throw new Error(`Corrupt asset: ${table.slug}`);
    const result = deserializeAnalysis(JSON.parse(gunzipSync(compressed).toString("utf8")), entry);
    assertLibraryTargets(table.slug, result.strategyLists);
    if (Math.abs(result.returnPct - table.referenceReturnPct) > 0.005) throw new Error(`Return mismatch: ${table.slug}`);
    console.log(`${table.name}: verified ${result.perHand.size} hands, ${result.returnPct.toFixed(8)}%`);
  }
}

async function generate(): Promise<void> {
  await mkdir(output, { recursive: true });
  const manifest: PrecomputedManifest = { schemaVersion: 4, engineVersion: ENGINE_VERSION, compression: "gzip", entries: [] };
  for (const table of PAY_TABLE_LIBRARY) {
    const started = performance.now();
    const vector = standardVariant.valueVector(table, 5, {});
    const analysis = analyzeGame(table.familyId, vector, undefined, { betCoins: 5 });
    if (Math.abs(analysis.returnPct - table.referenceReturnPct) > 0.005) {
      throw new Error(`${table.name}: computed return ${analysis.returnPct} fails the reference tolerance.`);
    }
    const key = analysisKey(table.familyId, vector, 5);
    registerTrainingAnalysis(key, analysis);
    const strategyLists = STRATEGY_TIERS.map(tier => generateStrategyList(key, tier));
    assertLibraryTargets(table.slug, strategyLists);
    for (const list of strategyLists) for (const line of list.lines) {
      describeLabel(line.label, table.familyId);
      for (const exception of line.exceptions) describeLabel(exception.prefer, table.familyId);
    }
    const serialized = serializeAnalysis(analysis, table.id, strategyLists);
    const compressed = gzipSync(JSON.stringify(serialized), { level: 9 });
    const file = `${serialized.key}.bin`;
    // Atomic replacement: a failed write must not leave a partially valid asset.
    await writeFile(resolve(output, `${file}.tmp`), compressed);
    await rename(resolve(output, `${file}.tmp`), resolve(output, file));
    manifest.entries.push({
      slug: table.slug, name: table.name, paytableId: table.id, key: serialized.key,
      file, sha256: digest(compressed), bytes: compressed.byteLength, familyId: analysis.familyId,
      valueVector: [...analysis.valueVector], betCoins: analysis.betCoins, returnPct: analysis.returnPct,
      variance: analysis.variance, hitFreq: analysis.hitFreq, rankProbs: [...analysis.rankProbs],
    });
    console.log(`${table.name}: ${analysis.returnPct.toFixed(8)}%, variance ${analysis.variance.toFixed(6)}, ${(compressed.byteLength / 1024 / 1024).toFixed(2)} MiB, ${((performance.now() - started) / 1000).toFixed(2)}s`);
    for (const list of strategyLists) console.log(
      `  ${list.tier}: ${list.returnPct.toFixed(8)}%, gap ${list.costVsOptimal.toFixed(8)} pp; ` +
      `${list.lines.length} lines, ${strategyExceptionCount(list)} exceptions; meetsTarget=${list.meetsTarget}.`,
    );
    clearTrainingCache(key);
    // Only one family's working tables need to remain resident during a build.
    const next = PAY_TABLE_LIBRARY[manifest.entries.length];
    if (!next || next.familyId !== table.familyId) { clearSubsetCache(); clearEvaluatorCache(); }
  }
  await writeFile(resolve(output, "manifest.json.tmp"), JSON.stringify(manifestSchema.parse(manifest), null, 2) + "\n");
  await rename(resolve(output, "manifest.json.tmp"), resolve(output, "manifest.json"));
}

(process.argv.includes("--check") ? verify() : generate()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
