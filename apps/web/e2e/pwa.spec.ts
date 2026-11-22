import { expect, test } from "@playwright/test";

test("production app, saved sessions and cached worker analysis reopen fully offline", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // Ensure this page and its new worker are controlled by the installed SW.
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole("link", { name: "Wallets", exact: true }).click();
  await page.getByRole("button", { name: "Create play-money wallet", exact: true }).click();
  await page.getByRole("textbox", { name: "Wallet name", exact: true }).fill("Offline practice");
  await page.getByRole("textbox", { name: "Opening play-money amount", exact: true }).fill("50");
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await page.getByRole("button", { name: /New machine|Create.*machine/i }).first().click();
  await page.getByRole("textbox", { name: "Machine name", exact: true }).fill("Offline Jacks");
  await page.getByRole("button", { name: "Save configuration", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Prepare session", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Prepare session", exact: true }).click();
  await expect(page.getByText("99.544%", { exact: true })).toBeVisible({ timeout: 45_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Offline Jacks", exact: true })).toBeVisible();
  await expect(page.getByText("99.544%", { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // A click starts an async IndexedDB transaction; wait for its saved-state acknowledgment.
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Wallets", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select wallet Offline practice" })).toContainText("$50.00");
  expect(errors).toEqual([]);
});
