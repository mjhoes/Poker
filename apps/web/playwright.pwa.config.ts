import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
export default defineConfig({
  ...config,
  testMatch: "pwa.spec.ts",
  projects: [{ name: "offline" }],
  use: { ...config.use, baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "pnpm preview --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
