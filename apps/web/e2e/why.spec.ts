import { expect, test } from "@playwright/test";
import { chooseMask, createPlayTable, readPlayState } from "./play-helpers";

test("after a mistake the details explain why the best hold is better, hand by hand", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await createPlayTable(page, { amount: "100" });
  await page.getByRole("button", { name: "Table settings", exact: true }).click();
  await page.getByRole("button", { name: "Show after draw", exact: true }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  const analysis = (await readPlayState(page)).sessions[0].state.analysis!;
  const worst = [...analysis.results].sort((x, y) => x.ev - y.ev)[0];
  await chooseMask(page, worst.mask);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();

  // The details drawer is open after a mistake; the comparison is one click further.
  await page.getByText("Why is the best hold better?").click();
  const why = page.getByRole("region", { name: "Why the best hold is better" });
  await expect(why.locator(".why-summary")).toContainText(/more credits per line/);
  await expect(why.getByRole("img", { name: /^Best hold: / })).toBeVisible();
  await expect(why.getByRole("img", { name: /^Your hold: / })).toBeVisible();
  await expect(why.locator("tbody tr.is-decisive").first()).toBeVisible();
  const total = analysis.best.ev - worst.ev;
  await expect(why.locator("tfoot tr").last().locator("td").last()).toHaveText(`+${total.toFixed(3)}`);

  // Pick the best hold itself from the top holds: the two are the same.
  await why.getByRole("group", { name: "Top holds" }).getByRole("button").first().click();
  await expect(why.locator(".why-summary")).toContainText("exactly the same");
  // Toggle a card to build any hold.
  const cards = why.getByRole("group", { name: "Build a hold to compare" }).getByRole("button");
  await cards.first().click();
  await expect(why.locator(".why-cards-note")).toContainText("Holding");
  expect(errors).toEqual([]);
});
