import { expose } from "comlink";
import {
  analyzeGame, analyzeHandFast, clearSubsetCache, clearTrainingCache, ENGINE_VERSION, generateHand, generateStrategyList, registerTrainingAnalysis, standardVariant, STRATEGY_TIERS,
} from "@perfect-draw/engine";
import { analysisKey, getLibraryPayTable, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { deserializeAnalysis, loadPrecomputedAnalysis, loadPrecomputedManifest, serializeAnalysis } from "@perfect-draw/precomputed";
import type { PrecomputedGameAnalysis } from "@perfect-draw/precomputed";
import { analysisSchema } from "@perfect-draw/shared";
import { db, stamp } from "../data/db";
import type { AnalysisSummary, EngineAPI } from "./engine-api";

const loaded = new Map<string, PrecomputedGameAnalysis>();
let solverFamily = "";
function retain(key: string, analysis: PrecomputedGameAnalysis) {
  loaded.delete(key); loaded.set(key, analysis);
  registerTrainingAnalysis(key, analysis);
  // Keep multiple open sessions cheap on phones; the durable Dexie cache remains intact.
  while (loaded.size > 2) {
    const oldest = loaded.keys().next().value!;
    loaded.delete(oldest); clearTrainingCache(oldest);
  }
}
function prepareSolver(familyId: string) {
  if (solverFamily !== familyId) { clearSubsetCache(); solverFamily = familyId; }
}
function summary(analysis: PrecomputedGameAnalysis): AnalysisSummary {
  const { perHand: _hands, ...rest } = analysis;
  return { ...rest, key: analysisKey(analysis.familyId, analysis.valueVector, analysis.betCoins) };
}
async function cache(analysis: PrecomputedGameAnalysis, paytableId: string) {
  const value = summary(analysis);
  const payload = new Blob([JSON.stringify(serializeAnalysis(analysis, paytableId, [...analysis.strategyLists]))], { type: "application/json" });
  await db.records("analyses").put(analysisSchema.parse({
    ...value, ...stamp(), paytableId, variantKind: "standard", variantStateKey: "standard",
    perHandBlob: payload, computedAt: Date.now(),
  }));
  retain(value.key, analysis);
  return value;
}
const api: EngineAPI = {
  async analyzeHand(cards, paytableId, coins) {
    const table = await db.records("paytables").get(paytableId) ?? getLibraryPayTable(paytableId);
    if ("deletedAt" in table && table.deletedAt != null) throw new Error("This pay table was deleted.");
    prepareSolver(table.familyId);
    return analyzeHandFast(cards, standardVariant.valueVector(table, coins, {}), table.familyId);
  },
  async loadAnalysis(keyOrId) {
    const table = PAY_TABLE_LIBRARY.find(x => x.id === keyOrId || x.slug === keyOrId ||
      analysisKey(x.familyId, standardVariant.valueVector(x, 5, {}), 5) === keyOrId);
    const key = table ? analysisKey(table.familyId, standardVariant.valueVector(table, 5, {}), 5) : keyOrId;
    const existing = loaded.get(key);
    if (existing) return summary(existing);
    const raw = await db.records("analyses").get(key);
    if (raw?.engineVersion === ENGINE_VERSION) {
      try {
        const analysis = deserializeAnalysis(JSON.parse(await raw.perHandBlob.text()));
        if (analysisKey(analysis.familyId, analysis.valueVector, analysis.betCoins) !== key) throw new Error("Cached analysis key mismatch");
        retain(key, analysis); return summary(analysis);
      } catch {
        // A corrupt derived cache can be replaced from verified static assets, never an EV fallback.
        await db.records("analyses").delete(key);
      }
    }
    if (!table) throw new Error("No cached analysis with this key. Analyze this pay table first.");
    const manifest = await loadPrecomputedManifest();
    return cache(await loadPrecomputedAnalysis(table.id, manifest), table.id);
  },
  async analyzeGame(family, vector, betCoins, progress) {
    prepareSolver(family);
    const analysis = analyzeGame(family, vector, progress, { betCoins });
    const table = (await db.records("paytables").toArray()).find(x => x.familyId === family &&
      JSON.stringify(standardVariant.valueVector(x, betCoins, {})) === JSON.stringify(vector));
    if (!table) throw new Error("Save this pay table before computing its analysis.");
    const key = analysisKey(family, vector, betCoins);
    registerTrainingAnalysis(key, analysis);
    const strategyLists = STRATEGY_TIERS.map(tier => generateStrategyList(key, tier));
    return cache({ ...analysis, strategyLists }, table.id);
  },
  async generateDrill(options) {
    await api.loadAnalysis(options.analysisKey);
    return generateHand(options);
  },
};
expose(api);
