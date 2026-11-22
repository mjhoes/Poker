import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getLibraryPayTable, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { deserializeAnalysis, manifestSchema } from "./format";
import type { PrecomputedManifest, PrecomputedGameAnalysis } from "./format";

export { serializeAnalysis, deserializeAnalysis, manifestSchema } from "./format";
export type { ManifestEntry, PrecomputedManifest, SerializedAnalysis, PrecomputedGameAnalysis } from "./format";

export interface LoadOptions {
  /** Relative, same-origin by default; no API server is involved. */
  basePath?: string;
  fetch?: typeof globalThis.fetch;
}

export async function loadPrecomputedManifest(options: LoadOptions = {}): Promise<PrecomputedManifest> {
  const request = options.fetch ?? globalThis.fetch;
  const response = await request(`${options.basePath ?? "/analyses"}/manifest.json`);
  if (!response.ok) throw new Error(`Unable to load analysis manifest: HTTP ${response.status}`);
  const manifest = manifestSchema.parse(await response.json());
  if (new Set(manifest.entries.map(entry => entry.slug)).size !== PAY_TABLE_LIBRARY.length) {
    throw new Error("Analysis manifest contains duplicate entries.");
  }
  for (const table of PAY_TABLE_LIBRARY) {
    const entry = manifest.entries.find(item => item.slug === table.slug);
    if (!entry || entry.paytableId !== table.id || entry.file !== `${entry.key}.bin`) {
      throw new Error(`Analysis manifest is stale or incomplete: ${table.slug}`);
    }
  }
  return manifest;
}

/** Lazy-load one compressed training index; never eagerly bundle all indices. */
export async function loadPrecomputedAnalysis(
  idOrSlug: string,
  manifest: PrecomputedManifest,
  options: LoadOptions = {},
): Promise<PrecomputedGameAnalysis> {
  const table = getLibraryPayTable(idOrSlug);
  const entry = manifestSchema.parse(manifest).entries.find(item => item.paytableId === table.id);
  if (!entry || entry.file !== `${entry.key}.bin`) throw new Error(`No current precomputed analysis for ${table.slug}`);
  const request = options.fetch ?? globalThis.fetch;
  const response = await request(`${options.basePath ?? "/analyses"}/${entry.file}`);
  if (!response.ok) throw new Error(`Unable to load ${table.name}: HTTP ${response.status}`);
  const compressed = await response.arrayBuffer();
  if (compressed.byteLength !== entry.bytes || bytesToHex(sha256(new Uint8Array(compressed))) !== entry.sha256) {
    throw new Error("Precomputed analysis failed its integrity check.");
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress the analysis. A browser with DecompressionStream support is required.");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const json = await new Response(stream).json();
  return deserializeAnalysis(json, entry);
}
