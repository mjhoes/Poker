/*
 * Pay table photo accuracy (spec F2.1: at least 90% of real photos fully correct with no edits).
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @perfect-draw/web vision-eval <folder> [--provider anthropic|openai] [--tier light|medium|heavy]
 *   OPENAI_API_KEY=…    pnpm --filter @perfect-draw/web vision-eval <folder> --provider openai
 *
 * The folder holds photos (.jpg, .jpeg or .png; ideally at most ~1,600 px on the long edge, as the app sends) and, for
 * each, a <name>.json with the correct table: { "slug": "jacks-or-better-9-6" } for a built-in table, or
 * { "familyId": "jacks_or_better", "pays": { "ROYAL_FLUSH": [250, 500, 750, 1000, 4000], … } }.
 * Each photo is read exactly as the app reads it (same prompt, schema and mapping). This spends real money with your key.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join, basename } from "node:path";
import { getLibraryPayTable } from "@perfect-draw/paytables";
import type { GameFamilyId } from "@perfect-draw/engine";
import type { AiProvider, AiTier } from "@perfect-draw/shared";
import { createAnthropicProvider } from "../src/ai/anthropic";
import { createOpenAIProvider } from "../src/ai/openai";
import { costFor, formatCost, modelFor } from "../src/ai/models";
import { finalize, payingRanks } from "../src/paytables/model";
import type { DraftTable, PayRow } from "../src/paytables/model";
import { PAYTABLE_PROMPT, PAYTABLE_SYSTEM, paytableReplySchema, readPaytable } from "../src/photo/paytable-photo";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const folder = args.find(arg => !arg.startsWith("--") && !["anthropic", "openai", "light", "medium", "heavy"].includes(arg));
const provider = option("provider", "anthropic") as AiProvider;
const tier = option("tier", "medium") as AiTier;
if (!folder) { console.error("Usage: vision-eval <folder> [--provider anthropic|openai] [--tier light|medium|heavy]"); process.exit(1); }
const key = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
if (!key) { console.error(`Set ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}.`); process.exit(1); }

function expectedDraft(json: { slug?: string; familyId?: GameFamilyId; pays?: Record<string, number[]> }): DraftTable {
  if (json.slug) { const table = getLibraryPayTable(json.slug); return { familyId: table.familyId, pays: Object.fromEntries(Object.entries(table.pays).map(([rank, row]) => [rank, [...row] as PayRow])) }; }
  if (!json.familyId || !json.pays) throw new Error("Expected { slug } or { familyId, pays }.");
  return { familyId: json.familyId, pays: Object.fromEntries(Object.entries(json.pays).map(([rank, row]) => [rank, row as PayRow])) };
}

const client = provider === "anthropic" ? createAnthropicProvider(key) : createOpenAIProvider(key);
const model = modelFor(provider, tier).id;
const photos = (await readdir(folder)).filter(name => [".jpg", ".jpeg", ".png"].includes(extname(name).toLowerCase())).sort();
let correct = 0, cost = 0;
for (const name of photos) {
  const stem = basename(name, extname(name));
  let expected: DraftTable;
  try { expected = expectedDraft(JSON.parse(await readFile(join(folder, `${stem}.json`), "utf8"))); }
  catch (error) { console.log(`${name}: skipped (${error instanceof Error ? error.message : error})`); continue; }
  const bytes = await readFile(join(folder, name));
  const mediaType = extname(name).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  try {
    const result = await client.text({ system: PAYTABLE_SYSTEM, prompt: PAYTABLE_PROMPT, schema: paytableReplySchema, model, image: { base64: bytes.toString("base64"), mediaType } });
    cost += costFor(result.model, result.inputTokens, result.outputTokens, model);
    const reading = readPaytable(result.data);
    const ok = reading.familyId === expected.familyId && reading.unknown.length === 0 && finalize(reading.draft).id === finalize(expected).id;
    if (ok) correct++;
    const wrong = reading.familyId !== expected.familyId ? [`game ${reading.familyId} (expected ${expected.familyId})`]
      : payingRanks(expected.familyId).filter(rank => JSON.stringify(reading.draft.pays[rank]) !== JSON.stringify(expected.pays[rank]));
    console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `: ${[...wrong, ...reading.unknown.map(row => `unknown "${row.label}"`)].join("; ")}`}`);
  } catch (error) { console.log(`✗ ${name}: ${error instanceof Error ? error.message : error}`); }
}
const total = photos.length;
console.log(`\n${correct} of ${total} fully correct with no edits (${total ? ((correct / total) * 100).toFixed(0) : 0}%; target 90%) · ${modelFor(provider, tier).name} · about ${formatCost(cost)}`);
