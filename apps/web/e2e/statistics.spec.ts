import { expect, test } from "@playwright/test";
import { canonicalizeHand } from "@perfect-draw/engine";
import type { HandAnalysis } from "@perfect-draw/engine";
import type { Records, Session } from "@perfect-draw/shared";
import { chooseMask, createPlayTable, preparePlaySession, readPlayState } from "./play-helpers";

test.describe("local-day retention and estimated returns", () => {
  test.use({ timezoneId: "America/New_York" });
  test("startup rollup keeps estimates, local dates, backup contents and the 500-decision reminder", async ({ page }) => {
    test.setTimeout(120_000);
    await createPlayTable(page, { mode: "drill" });
    const expectedDay = await page.evaluate(async () => {
      const dbPath = "/src/data/db.ts", clientPath = "/src/worker/client.ts";
      const enginePath = "/@fs/home/runner/workspace/packages/engine/src/index.ts";
      const sharedPath = "/@fs/home/runner/workspace/packages/shared/src/index.ts";
      const [{ db }, { engineClient }, engine, shared] = await Promise.all([import(dbPath), import(clientPath), import(enginePath), import(sharedPath)]);
      const session = await db.records("sessions").toCollection().first() as Session;
      const paytableId = session.machineSnapshot.paytableId;
      const client = engineClient(), analysis = await client.loadAnalysis(paytableId);
      const report = await client.statistics({ paytableId, coins: 5, timeZone: "America/New_York" });
      const categories = [...report.categories] as { label: string; frequency: number }[];
      categories.sort((a, b) => b.frequency - a.frequency);
      const old = new Date(Date.now() - 91 * 86_400_000);
      old.setUTCHours(0, 0, 0, 0); // 8 PM on the preceding New York summer calendar date.
      const at = old.getTime(), rows: Records["decisions"][] = [];
      let coverage = 0;
      for (const category of categories) {
        const drill = await client.generateDrill({ analysisKey: analysis.key, targetLabels: [category.label], sampling: "real" });
        const hand = await client.analyzeHand(drill.hand, paytableId, 5) as HandAnalysis;
        const worst = hand.results.reduce((a, b) => a.ev < b.ev ? a : b);
        const grade = engine.gradeDecision(hand, worst.mask);
        rows.push(shared.decisionSchema.parse({
          id: shared.newId(), updatedAt: Date.now(), sessionId: session.id, paytableId, analysisKey: analysis.key,
          canonicalHandId: engine.canonicalizeHand(hand.hand).id, dealtCards: hand.hand, ...grade,
          decisionMs: 100, handIndexInSession: rows.length + 1, msSinceSessionStart: 0,
          priorOutcome: null, createdAt: at, coins: 5,
        }));
        coverage += category.frequency;
        if (coverage >= 0.995) break;
      }
      while (rows.length < 500) rows.push({ ...rows[0], id: shared.newId() });
      rows.push({ ...rows[0], id: shared.newId(), isCorrection: true, attemptIndex: 1,
        chosenMask: rows[0].bestMask, chosenEv: rows[0].bestEv, evLoss: 0, chosenLabel: rows[0].bestLabel });
      await db.records("decisions").bulkAdd(rows);
      return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" }).format(at);
    });
    await page.reload();
    await expect.poll(async () => page.evaluate(async () => {
      const path = "/src/data/db.ts"; const { db } = await import(path);
      return await db.records("decisions").count() === 0 && await db.records("dailyAggregates").count() > 0;
    }), { timeout: 60_000 }).toBe(true);
    await expect(page.getByText(/500 or more decisions since your last backup/)).toBeVisible();
    await page.getByRole("link", { name: "Statistics", exact: true }).click();
    await expect(page.locator(".stats-metric").filter({ hasText: "Primary decisions" }).locator("strong")).toHaveText("500");
    await expect(page.locator(".stats-estimate")).toContainText("Real-play weighted ESTIMATE");
    await expect(page.locator(".stats-estimate")).toContainText("pooled recency-weighted");
    await page.locator(".stats-return-grid").screenshot({ path: "../../generated-artifacts/screenshots/cleanup-return-estimate.jpg" });
    await expect(page.getByText(/Excluded from primary totals: 1 corrected/)).toBeVisible();
    await page.getByText(/^View daily data table/).click();
    await expect(page.getByRole("rowheader", { name: expectedDay, exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const stream = await (await downloadPromise).createReadStream();
    let text = ""; for await (const chunk of stream!) text += chunk.toString();
    const backup = JSON.parse(text);
    expect(backup.tables.decisions).toHaveLength(0);
    expect(backup.tables.dailyAggregates.reduce((sum: number, row: { n: number }) => sum + row.n, 0)).toBe(500);
    expect(backup.tables.profile[0].prefs.lastBackupDecisionCount).toBe(501);
    await expect(page.getByText(/500 or more decisions since your last backup/)).toHaveCount(0);
  });
});

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
  // Genuine engine holds/EVs. Shift timestamps for trends and give the correct
  // attempt a distinct legacy positional label so zero-loss-row coverage cannot
  // randomly disappear when another hand happens to use the same label pair.
  await page.evaluate(async () => {
    const { db } = await import("/src/data/db.ts" as string) as typeof import("../src/data/db");
    const rows = (await db.records("decisions").toArray()).sort((a, b) => a.createdAt - b.createdAt);
    await db.records("decisions").update(rows[0].id, { createdAt: Date.now() - 14 * 86_400_000 });
    await db.records("decisions").update(rows[1].id, { createdAt: Date.now() - 7 * 86_400_000, chosenLabel: "EQUIVALENT_POSITIONAL_HOLD" });
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
  await expect(page.getByRole("img", { name: /Daily accuracy by local day/ })).toBeVisible();
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
  expect(costs.every(value => value > 0)).toBe(true);
  await page.getByRole("checkbox", { name: "Show zero-loss / equivalent holds" }).check();
  await expect(page.getByText("· Equivalent hold / zero loss", { exact: false }).first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Show zero-loss / equivalent holds" }).uncheck();
  expect(costs).toEqual([...costs].sort((a, b) => a - b));
  await page.getByRole("combobox", { name: "Session mode", exact: true }).selectOption("drill");
  await expect(primary).toHaveText("3");
  await page.getByRole("combobox", { name: "Session mode", exact: true }).selectOption("free_play");
  await expect(primary).toHaveText("1");
  await page.getByRole("combobox", { name: "Session mode", exact: true }).selectOption("all");
  await expect(primary).toHaveText("4");
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("From (local)", { exact: true }).fill(today);
  await expect(primary).toHaveText("2");
  await page.getByLabel("From (local)", { exact: true }).fill("");
  await expect(primary).toHaveText("4");
  await page.getByRole("combobox", { name: "Trend measure" }).selectOption("evLostPer1000");
  await expect(page.getByRole("img", { name: /EV loss per 1,000 hands by local day/ })).toBeVisible();
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
  await page.getByLabel("From (local)", { exact: true }).fill("2026-11-23");
  await page.getByLabel("Through (local)", { exact: true }).fill("2026-11-22");
  await expect(page.getByRole("alert")).toContainText("start date must be on or before");
  await page.getByLabel("From (local)", { exact: true }).fill("");
  await page.getByLabel("Through (local)", { exact: true }).fill("");
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
