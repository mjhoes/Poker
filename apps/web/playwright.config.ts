import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
function systemChromium() {
  try { return execFileSync("which", ["chromium"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return undefined; } // Else use Playwright's browser on conventional developer machines.
}
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["foundation.spec.ts", "play.spec.ts", "statistics.spec.ts", "paytables.spec.ts", "analysis.spec.ts", "machines.spec.ts", "bet.spec.ts", "why.spec.ts", "analyzer.spec.ts", "ai.spec.ts", "photo.spec.ts", "cruise.spec.ts", "pace.spec.ts", "train.spec.ts", "heuristics.spec.ts"],
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
  /*
   * The responsiveness check (tagged @timing: drill feedback under 50 ms) runs by itself in a fresh worker after the
   * rest of the suite, so its measurement isn't skewed by a browser that has already run ~30 tests. If another test
   * fails, Playwright skips it (reported as "did not run"); run it alone with `--project=timing --no-deps`.
   */
  projects: [
    { name: "e2e", grepInvert: /@timing/ },
    { name: "timing", testMatch: ["play.spec.ts"], grep: /@timing/, dependencies: ["e2e"] },
  ],
});
