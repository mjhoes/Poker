import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function createWallet(page: Page, name = "Cruise practice", amount = "100.00") {
  await page.getByRole("link", { name: "Wallets", exact: true }).click();
  await page.getByRole("button", { name: /Set up a wallet|New wallet/ }).first().click();
  await page.getByRole("textbox", { name: "Wallet name", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Starting balance", exact: true }).fill(amount);
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function createMachine(page: Page) {
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await page.getByRole("button", { name: /New machine|Create.*machine/i }).first().click();
  await page.getByRole("textbox", { name: "Machine name", exact: true }).fill("Quarter Jacks");
  await page.getByRole("button", { name: "Add machine", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function prepareSession(page: Page) {
  await page.getByRole("button", { name: /^(Play|Continue)$/ }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
}
test("machines, wallets, sessions, worker and backup survive reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await createWallet(page);
  await createMachine(page);
  await prepareSession(page);
  await page.getByText("Optional table analysis", { exact: true }).click();
  await expect(page.getByText("99.544%", { exact: true })).toBeVisible({ timeout: 45_000 });
  // Retain the legacy saved-hand persistence regression from the foundation phase.
  const ids = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/state/app-store.ts" as string) as typeof import("../src/state/app-store");
    const { sessionService } = await import("/src/services/sessions.ts" as string) as typeof import("../src/services/sessions");
    const state = useAppStore.getState();
    const first = state.activeSessionId!;
    await sessionService.applyAction(first, { type: "saveHand", hand: [50, 46, 42, 38, 35], heldMask: 15 });
    const second = await sessionService.start({ machineId: state.sessions[first].machineId, mode: "drill" });
    await sessionService.activate(first);
    return { first, second: second.id };
  });
  await page.reload();
  const ace = page.getByRole("button", { name: /A of hearts, held/ });
  await expect(ace).toHaveAttribute("aria-pressed", "true");
  await ace.click();
  await expect(page.getByRole("button", { name: /A of hearts, not held/ })).toHaveAttribute("aria-pressed", "false");
  const switchMs = await page.evaluate(async secondId => {
    const { useAppStore } = await import("/src/state/app-store.ts" as string) as typeof import("../src/state/app-store");
    const started = performance.now();
    return new Promise<number>(resolve => {
      const unsubscribe = useAppStore.subscribe(state => {
        if (state.activeSessionId === secondId) {
          unsubscribe();
          requestAnimationFrame(() => resolve(performance.now() - started));
        }
      });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", ctrlKey: true, bubbles: true, cancelable: true }));
    });
  }, ids.second);
  expect(switchMs).toBeLessThan(200);
  await expect(page.getByRole("button", { name: /Select session 2.*active/ })).toBeVisible();
  await page.keyboard.press("Control+1");
  await expect(page.getByRole("button", { name: /A of hearts, not held/ })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  // This invokes the actual Comlink worker; the returned EVs and holds come from the engine.
  const worker = await page.evaluate(async () => {
    const { engineClient, resetEngineClient } = await import("/src/worker/client.ts" as string) as typeof import("../src/worker/client");
    const { useAppStore } = await import("/src/state/app-store.ts" as string) as typeof import("../src/state/app-store");
    const tableId = Object.values(useAppStore.getState().sessions)[0].machineSnapshot.paytableId;
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    try {
      const result = await engineClient().analyzeHand([50, 46, 42, 38, 35], tableId, 5);
      const loaded = await engineClient().loadAnalysis(tableId);
      const drill = await engineClient().generateDrill({ analysisKey: loaded.key });
      resetEngineClient();
      const restored = await engineClient().loadAnalysis(tableId);
      return { mask: result.best.mask, results: result.results.length, returnPct: restored.returnPct, drill: drill.hand, ticks };
    } finally { clearInterval(timer); }
  });
  expect(worker.mask).toBe(15);
  expect(worker.results).toBe(32);
  expect(worker.returnPct).toBeCloseTo(99.54390437, 6);
  expect(new Set(worker.drill).size).toBe(5);
  expect(worker.ticks).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const file = await download;
  const stream = await file.createReadStream();
  let json = "";
  for await (const chunk of stream!) json += chunk.toString();
  expect(json).not.toContain('"aiKeys"');
  await createWallet(page, "Temporary", "0");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Import backup file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(json) });
  const restoreDialog = page.getByRole("dialog");
  const replace = restoreDialog.getByRole("button", { name: "Replace my data", exact: true });
  await expect(replace).toBeDisabled();
  await restoreDialog.getByRole("checkbox").check();
  await replace.click();
  await expect(page.getByText(/Backup restored:/)).toBeVisible();
  await page.waitForTimeout(1200); // Restore intentionally reloads the app after confirming success.
  await expect.poll(() => page.evaluate(async () => {
    const { useAppStore } = await import("/src/state/app-store.ts" as string) as typeof import("../src/state/app-store");
    return useAppStore.getState().wallets.length;
  })).toBe(1);
  const restored = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/state/app-store.ts" as string) as typeof import("../src/state/app-store");
    const s = Object.values(useAppStore.getState().sessions)[0];
    return { state: s.state.heldMask, keys: Object.keys(useAppStore.getState().sessions) };
  });
  expect(restored.state).toBe(14);
  expect(restored.keys).toEqual(expect.arrayContaining([ids.first, ids.second]));
  expect(errors).toEqual([]);
});

test("mobile wallet forms validate input and fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await createWallet(page);
  await page.getByRole("button", { name: /Top.up|Add credits/i }).first().click();
  await page.getByRole("textbox", { name: "Amount in dollars" }).fill("-1");
  await page.getByRole("dialog").getByRole("button", { name: "Add credits", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/greater than.*0.00/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("wallet transfers and machine editing/deletion are wired to persistent services", async ({ page }) => {
  await page.goto("/");
  await createWallet(page);
  await createWallet(page, "Reserve", "0");
  await page.getByRole("button", { name: "Select wallet Cruise practice", exact: true }).locator("..").getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Wallet name", exact: true }).fill("Main practice");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Select wallet Main practice", exact: true }).locator("..").getByRole("button", { name: "Transfer", exact: true }).click();
  await page.getByRole("textbox", { name: "Amount in dollars" }).fill("25");
  await page.getByRole("button", { name: "Transfer credits", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select wallet Reserve", exact: true })).toContainText("$25.00");
  await expect(page.getByRole("button", { name: "Select wallet Main practice", exact: true })).toContainText("$75.00");
  await createMachine(page);
  await page.getByRole("button", { name: "More actions for Quarter Jacks", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Machine name", exact: true }).fill("Dollar Jacks");
  await page.getByRole("textbox", { name: "Denomination in dollars", exact: true }).fill("1.00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dollar Jacks", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions for Dollar Jacks", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirmDelete = page.getByRole("dialog");
  await expect(confirmDelete.getByRole("heading", { name: "Delete “Dollar Jacks”?" })).toBeVisible();
  await expect(confirmDelete.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await confirmDelete.getByRole("button", { name: "Delete machine", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Dollar Jacks", exact: true })).toHaveCount(0);
});

test("unavailable workers do not prevent wallet management", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "Worker", { value: undefined }); });
  await page.goto("/");
  await createWallet(page);
  await createMachine(page);
  await prepareSession(page);
  await page.getByText("Optional table analysis", { exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Table analysis unavailable" })).toBeVisible();
  await page.getByRole("link", { name: "Wallets", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select wallet Cruise practice", exact: true })).toContainText("$100.00");
});
