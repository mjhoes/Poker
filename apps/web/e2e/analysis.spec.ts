import { expect, test } from "@playwright/test";

test("table analysis and statistics work when analysis downloads fail", async ({ page, context }) => {
  test.setTimeout(150_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let blocked = 0;
  // Every static analysis file fails at the network level, as a dropped connection would ("Failed to fetch").
  await context.route("**/analyses/**", route => { blocked++; return route.abort("failed"); });
  await page.goto("/");
  await page.getByRole("button", { name: /^Start with/ }).click();
  await page.getByRole("button", { name: "Add 9/6 Jacks or Better" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();

  await page.getByText("Optional table analysis", { exact: true }).click();
  const computedReturn = page.locator(".analysis-stat").filter({ hasText: "Computed return" }).locator("strong");
  await expect(computedReturn).toHaveText("99.544%", { timeout: 60_000 });
  await expect(page.locator(".analysis-stat").filter({ hasText: "Bet" }).locator("strong")).toHaveText("5 coins");
  expect(blocked).toBeGreaterThan(0);

  // The figure is saved per table and bet: reopening it needs neither the network nor a recomputation.
  await page.reload();
  await page.getByText("Optional table analysis", { exact: true }).click();
  await expect(computedReturn).toHaveText("99.544%", { timeout: 5_000 });

  await page.getByRole("link", { name: "Statistics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start with a real hand.", exact: true })).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});
