import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { manifestSchema } from "../packages/precomputed/src/format";

const source = resolve("packages/precomputed/assets");
const destination = resolve("apps/web/public/analyses");
const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8")));
const files = new Set(["manifest.json", ...manifest.entries.map(entry => entry.file)]);
await mkdir(destination, { recursive: true });
// Only these generated files are owned by this script. Do not ship stale engine
// versions just because their ignored build output remains in the workspace.
for (const name of await readdir(destination)) {
  if (/^[0-9a-f]{64}\.bin$/.test(name) && !files.has(name)) await rm(resolve(destination, name));
}
await Promise.all([...files].map(name => cp(resolve(source, name), resolve(destination, name))));
console.log("Copied compressed analysis assets to the web client's static public files.");
