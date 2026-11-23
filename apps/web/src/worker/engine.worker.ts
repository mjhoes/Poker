import { rollupDecisions } from "../services/retention";
import { expose } from "comlink";
import {
  analyzeGame, analyzeHandFast, clearSubsetCache, clearTrainingCache, dealRound, ENGINE_VERSION, generateHand, generateStrategyList, registerTrainingAnalysis, resolveRound, standardVariant, STRATEGY_TIERS,
} from "@perfect-draw/engine";
import { analysisKey, getLibraryPayTable, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { deserializeAnalysis, loadPrecomputedAnalysis, loadPrecomputedManifest, serializeAnalysis } from "@perfect-draw/precomputed";
import type { PrecomputedGameAnalysis } from "@perfect-draw/precomputed";
import { analysisSchema } from "@perfect-draw/shared";
import { db, stamp } from "../data/db";
import type { AnalysisSummary, EngineAPI } from "./engine-api";
import { StatsEngine } from "./stats-engine";

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
  rollupDecisions: timeZone => rollupDecisions(timeZone, (table, coins) => statsEngine.game(table, coins)),
  async statistics(input) { return statsEngine.report(input); },
  async validateTraining(paytableId, coins, label) { return statsEngine.validateTraining(paytableId, coins, label); },
  async prepareRound(paytableId, coins, lines, focus) {
    const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const dealt = dealRound(lines, random);
    if (focus) {
      const analysis = await statsEngine.prepareTarget(paytableId, coins, focus.label, focus.analysisKey);
      const remaining = Array.from({ length: 52 }, (_, i) => i).filter(card => !analysis.hand.includes(card));
      // Drills never draw or pay, but keep the same validated persistent round format.
      return { analysis, drawDecks: [remaining] };
    }
    return { analysis: await api.analyzeHand(dealt.hand, paytableId, coins), drawDecks: dealt.drawDecks };
  },
  async resolveRound(hand, mask, decks, paytableId, coins) {
    const table = await db.records("paytables").get(paytableId) ?? getLibraryPayTable(paytableId);
    return resolveRound(hand, mask, decks, table.familyId, standardVariant.valueVector(table, coins, {}));
  },
  async analyzeHand(cards, paytableId, coins) {
    const table = await db.records("paytables").get(paytableId) ?? getLibraryPayTable(paytableId);
    if ("deletedAt" in table && table.deletedAt != null) throw new Error("This pay table was deleted.");
    prepareSolver(table.familyId);
    return analyzeHandFast(cards, standardVariant.valueVector(table, coins, {}), table.familyId);
  },
  async loadAnalysis(keyOrId) {
    const table = PAY_TABLE_LIBRARY.find(x => x.id === keyOrId || x.slug === keyOrId ||
      analysisKey(x.familyId, standardVariant.valueVector(x, 5, {}), 5) === keyOrId);
    // A hand-entered table has no static asset: its first analysis is computed here (about 20 s) and then cached.
    const custom = table ? undefined : await db.records("paytables").get(keyOrId);
    if (custom && custom.deletedAt == null) {
      const vector = standardVariant.valueVector(custom, 5, {});
      const customKey = analysisKey(custom.familyId, vector, 5);
      const cachedCustom = loaded.get(customKey) ?? await (async () => {
        const raw = await db.records("analyses").get(customKey);
        if (raw?.engineVersion !== ENGINE_VERSION) return undefined;
        try { return deserializeAnalysis(JSON.parse(await raw.perHandBlob.text())); } catch { return undefined; }
      })();
      if (cachedCustom) { retain(customKey, cachedCustom); return summary(cachedCustom); }
      return api.analyzeGame(custom.familyId, vector, 5);
    }
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
  async previewGame(family, vector) {
    prepareSolver(family);
    const analysis = analyzeGame(family, vector, undefined, { betCoins: 5 });
    return { returnPct: analysis.returnPct, hitFreq: analysis.hitFreq, variance: analysis.variance, engineVersion: ENGINE_VERSION };
  },
  async generateDrill(options) {
    await api.loadAnalysis(options.analysisKey);
    const analysis = loaded.get(options.analysisKey);
    if (analysis) registerTrainingAnalysis(options.analysisKey, analysis);
    return generateHand(options);
  },
};
const statsEngine = new StatsEngine(async paytableId => {
  const value = await api.loadAnalysis(paytableId);
  const analysis = loaded.get(value.key);
  if (!analysis) throw new Error("Full analysis was evicted before statistics could read it.");
  return analysis;
}, prepareSolver);
expose(api);
