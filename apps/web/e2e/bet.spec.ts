import { expect, test } from "@playwright/test";
import { createPlayTable, readPlayState } from "./play-helpers";

test("the bet changes between hands at the table and is locked during a hand", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await createPlayTable(page, { amount: "100" });
  await page.getByRole("button", { name: "Table settings", exact: true }).click();
  await page.getByRole("button", { name: "Show after draw", exact: true }).click();
  await page.keyboard.press("Escape");
  const bets = page.getByRole("radiogroup", { name: "Credits per line" });
  await expect(bets.getByRole("radio", { name: "5 credits" })).toHaveAttribute("aria-checked", "true");

  await bets.getByRole("radio", { name: "2 credits" }).click();
  await expect(page.locator(".bet-total")).toHaveText("$0.50 per hand");
  await expect(page.locator(".bet-note")).toContainText("At 2 coins the royal pays 500; at 5 coins it pays 4,000.");
  await expect(page.locator(".meter").filter({ hasText: "Bet" }).locator(".meter-value")).toHaveText("2");
  await expect(page.getByRole("region", { name: /pay table/ }).locator("thead th.is-bet").first()).toContainText("2");

  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  await expect(page.locator(".bet-total")).toHaveText("Locked for this hand");
  await expect(bets.getByRole("radio", { name: "4 credits" })).toBeDisabled();
  let audit = await readPlayState(page);
  expect(audit.sessions[0].summary.coinInCents).toBe(50);
  expect(audit.sessions[0].state).toMatchObject({ betCoins: 2, handCoins: 2 });

  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  audit = await readPlayState(page);
  expect(audit.decisions[0].coins).toBe(2);

  // B cycles Bet One (2 → 3); M is Bet Max: five credits and a new deal.
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("b");
  await expect(bets.getByRole("radio", { name: "3 credits" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("m");
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  audit = await readPlayState(page);
  expect(audit.sessions[0].state).toMatchObject({ betCoins: 5, handCoins: 5 });
  expect(audit.sessions[0].summary.coinInCents).toBe(50 + 125);
  expect(errors).toEqual([]);
});
