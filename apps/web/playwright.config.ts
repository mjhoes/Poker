import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
function systemChromium() {
  try { return execFileSync("which", ["chromium"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return undefined; } // Else use Playwright's browser on conventional developer machines.
}
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["foundation.spec.ts", "play.spec.ts", "statistics.spec.ts", "paytables.spec.ts", "analysis.spec.ts", "machines.spec.ts", "bet.spec.ts", "why.spec.ts", "analyzer.spec.ts"],
  outputDir: "../../generated-artifacts/playwright",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    actionTimeout: 10_000,
    baseURL: process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000",
    headless: true,
    launchOptions: { executablePath: systemChromium(), args: ["--no-sandbox"] },
  },
  reporter: "list",
});
