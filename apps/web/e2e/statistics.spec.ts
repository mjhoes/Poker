import { expect, test } from "@playwright/test";
import { canonicalizeHand } from "@perfect-draw/engine";
import { chooseMask, createPlayTable, preparePlaySession, readPlayState } from "./play-helpers";

test("statistics audit real decisions, exclude corrections, filter and open persistent targeted training", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await createPlayTable(page, { mode: "drill" });
  for (let index = 0; index < 3; index++) {
    await page.getByRole("button", { name: "Deal hand", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check answer", exact: true })).toBeEnabled();
    const session = (await readPlayState(page)).sessions[0];
    const analysis = session.state.analysis!;
    await chooseMask(page, index === 1 ? analysis.best.mask : analysis.results.find(row => row.ev < analysis.best.ev - 1e-9)!.mask);
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  }
  // Genuine engine decisions, timestamp-shifted only to exercise historical trends/date filters.
  await page.evaluate(async () => {
    const { db } = await import("/src/data/db.ts" as string) as typeof import("../src/data/db");
    const rows = (await db.records("decisions").toArray()).sort((a, b) => a.createdAt - b.createdAt);
    await db.records("decisions").update(rows[0].id, { createdAt: Date.now() - 14 * 86_400_000 });
    await db.records("decisions").update(rows[1].id, { createdAt: Date.now() - 7 * 86_400_000 });
  });
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await preparePlaySession(page, "free_play");
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  const free = (await readPlayState(page)).sessions.find(row => row.mode === "free_play")!;
  const wrong = free.state.analysis!.results.find(row => row.ev < free.state.analysis!.best.ev - 1e-9)!;
  await chooseMask(page, wrong.mask);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hold review", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use best hold", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hold review", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Statistics", exact: true }).click();
  const primary = page.locator(".stats-metric").filter({ hasText: "Primary decisions" }).locator("strong");
  await expect(primary).toHaveText("4", { timeout: 45_000 });
  await expect(page.locator(".stats-metric").filter({ hasText: "Accuracy" }).locator("strong")).toHaveText("25.000%");
  await expect(page.getByText(/1 corrected decisions/)).toBeVisible();
  await expect(page.getByText(/covered-return ceiling; incomplete coverage/)).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily accuracy by UTC day/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /weakness|Weakness/ })).toBeVisible();
  await expect.poll(() => page.locator(".stats-chart svg path").count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator(".stats-weakness-chart svg path").count()).toBeGreaterThan(0);
  await page.locator(".stats-trend").screenshot({ path: "../../generated-artifacts/screenshots/statistics-trend.jpg" });
  await page.locator(".stats-weakness-chart-block").screenshot({ path: "../../generated-artifacts/screenshots/statistics-weakness.jpg" });
  await page.getByText(/^View daily data table/).click();
  await expect(page.locator(".stats-trend table tbody tr")).toHaveCount(3);
  const lossHeader = page.getByRole("columnheader", { name: /Raw EV loss/ });
  await expect(lossHeader).toHaveAttribute("aria-sort", "descending");
  await lossHeader.getByRole("button").click();
  await expect(lossHeader).toHaveAttribute("aria-sort", "ascending");
  const costs = await page.locator(".confusion-table tbody tr").evaluateAll(rows => rows.map(row => parseFloat(row.querySelectorAll("td")[3].textContent ?? "")));
  expect(costs).toEqual([...costs].sort((a, b) => a - b));
  await page.getByRole("combobox", { name: "Session mode", exact: true }).selectOption("drill");
  await expect(primary).toHaveText("3");
  await page.getByRole("combobox", { name: "Session mode", exact: true }).selectOption("free_play");
  await expect(primary).toHaveText("1");
  await page.getByRole("combobox", { name: "Session mode", exact: true }).selectOption("all");
  await expect(primary).toHaveText("4");
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("From (UTC)", { exact: true }).fill(today);
  await expect(primary).toHaveText("2");
  await page.getByLabel("From (UTC)", { exact: true }).fill("");
  await expect(primary).toHaveText("4");
  await page.getByRole("combobox", { name: "Trend measure" }).selectOption("evLostPer1000");
  await expect(page.getByRole("img", { name: /EV loss per 1,000 hands by UTC day/ })).toBeVisible();
  await page.getByRole("heading", { name: "Decision ledger", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../generated-artifacts/screenshots/statistics-desktop.jpg" });
  await page.locator(".stats-category").first().getByRole("button", { name: "Train this", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible({ timeout: 30_000 });
  const focused = (await readPlayState(page)).sessions.find(row => row.trainingFocus)!;
  expect(focused.mode).toBe("drill"); expect(focused.trainingFocus?.analysisKey).toMatch(/^[a-f0-9]{64}$/);
  for (let index = 0; index < 2; index++) {
    if (index === 1) {
      await page.reload();
      await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
      expect((await readPlayState(page)).sessions.find(row => row.id === focused.id)!.trainingFocus).toEqual(focused.trainingFocus);
    }
    await page.getByRole("button", { name: "Deal hand", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check answer", exact: true })).toBeEnabled();
    const current = (await readPlayState(page)).sessions.find(row => row.id === focused.id)!;
    const canonical = canonicalizeHand(current.state.analysis!.hand).hand;
    const label = await page.evaluate(async ({ cards, paytableId }) => {
      const { engineClient } = await import("/src/worker/client.ts" as string) as typeof import("../src/worker/client");
      return (await engineClient().analyzeHand(cards, paytableId, 5)).best.label;
    }, { cards: canonical, paytableId: focused.machineSnapshot.paytableId });
    expect(label).toBe(focused.trainingFocus!.label);
    await chooseMask(page, current.state.analysis!.best.mask);
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("mobile statistics handles empty scopes, exact short-coin baselines and worker errors", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createPlayTable(page, { mode: "drill" });
  await page.getByRole("link", { name: "Statistics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start with a real hand.", exact: true })).toBeVisible({ timeout: 45_000 });
  const primary = page.locator(".stats-metric").filter({ hasText: "Primary decisions" }).locator("strong");
  await expect(primary).toHaveText("0");
  await page.getByRole("combobox", { name: "Coins per hand", exact: true }).selectOption("1");
  await expect(primary).toHaveText("0", { timeout: 45_000 });
  const optimal = page.locator(".stats-metric").filter({ hasText: "Optimal return" }).locator("strong");
  await expect(optimal).toHaveText(/^98\./, { timeout: 45_000 });
  const oneCoinReturn = parseFloat((await optimal.textContent())!);
  expect(oneCoinReturn).toBeLessThan(99);
  expect(oneCoinReturn).toBeGreaterThan(97);
  await expect(page.getByText("No matching live machine.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Train this", exact: true }).first()).toBeDisabled();
  await page.getByLabel("From (UTC)", { exact: true }).fill("2026-11-23");
  await page.getByLabel("Through (UTC)", { exact: true }).fill("2026-11-22");
  await expect(page.getByRole("alert")).toContainText("start date must be on or before");
  await page.getByLabel("From (UTC)", { exact: true }).fill("");
  await page.getByLabel("Through (UTC)", { exact: true }).fill("");
  await expect(primary).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("heading", { name: "Decision ledger", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../generated-artifacts/screenshots/statistics-mobile.jpg" });
  await page.addInitScript(() => { Object.defineProperty(window, "Worker", { value: undefined }); });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Statistics could not be loaded");
  await page.getByRole("button", { name: "Retry report", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Statistics could not be loaded");
  await page.getByRole("link", { name: "Wallets", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select wallet Play test wallet", exact: true })).toBeVisible();
});
