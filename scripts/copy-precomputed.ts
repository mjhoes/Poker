import { cp } from "node:fs/promises";
import { resolve } from "node:path";

await cp(resolve("packages/precomputed/assets"), resolve("apps/web/public/analyses"), { recursive: true });
console.log("Copied compressed analysis assets to the web client's static public files.");
