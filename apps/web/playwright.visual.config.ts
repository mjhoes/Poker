import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

/**
 * Screenshot regression suite for interface work. Kept out of `test:e2e` because pixel baselines depend on the
 * browser build and installed fonts: regenerate them on a new machine with `pnpm test:visual --update-snapshots`.
 */
export default defineConfig({
  ...config,
  testMatch: "visual.spec.ts",
  projects: [{ name: "visual" }],
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: {
    ...config.expect,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" },
  },
});
