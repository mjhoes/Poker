import { expect, test } from "@playwright/test";

test("popular machines: one-click add, customize, single add control, and deal speed at the table", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /^Start with/ }).click();
  await page.getByRole("button", { name: "Add 9/6 Jacks or Better" }).click();
  await expect(page.getByRole("heading", { name: "Pick a machine." })).toBeVisible();
  // One way to add a machine: the tile at the end of the floor.
  await expect(page.getByRole("button", { name: /New machine/ })).toHaveCount(1);

  await page.getByRole("button", { name: /New machine/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("article")).toHaveCount(7);
  await sheet.getByRole("button", { name: "Add 10/7 Double Bonus" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "10/7 Double Bonus · 25¢" })).toBeVisible();

  await page.getByRole("button", { name: /New machine/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Customize 9/6 Bonus Poker Deluxe" }).click();
  await expect(page.getByRole("radiogroup", { name: "Game" }).getByRole("radio", { name: /^Bonus Poker Deluxe/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radiogroup", { name: "Lines" }).getByRole("radio", { name: "3 lines" }).click();
  await expect(page.getByRole("radiogroup", { name: "Table speed" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add machine", exact: true }).click();
  await expect(page.getByRole("article", { name: "9/6 Bonus Poker Deluxe · 25¢ · 3-play" })).toBeVisible();

  // Deal speed is a player preference chosen at the table, and it persists.
  await page.getByRole("article", { name: "9/6 Jacks or Better · 25¢" }).getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".play-table")).toHaveAttribute("data-speed", "normal");
  await page.getByRole("button", { name: "Table settings", exact: true }).click();
  await page.getByRole("group", { name: "Deal speed" }).getByRole("button", { name: "Fast" }).click();
  await expect(page.locator(".play-table")).toHaveAttribute("data-speed", "fast");
  await page.reload();
  await expect(page.locator(".play-table")).toHaveAttribute("data-speed", "fast");
  expect(errors).toEqual([]);
});
