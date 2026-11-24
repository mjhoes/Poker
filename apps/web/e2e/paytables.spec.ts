import { expect, test } from "@playwright/test";

test("custom pay tables: shorthand, checks, paste, save, play and protected delete", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /^Start with/ }).click();
  await expect(page.getByRole("heading", { name: "Pick your first machine." })).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "New pay table", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "Enter a pay table" })).toBeVisible();

  // Shorthand that matches a built-in table is recognised, and its exact return is computed by the engine.
  await editor.getByRole("textbox", { name: "Pay table shorthand" }).fill("8/5");
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor.getByText("These pays match the built-in 8/5 Jacks or Better.")).toBeVisible();
  await expect(editor.locator(".return-value")).toHaveText("97.30%", { timeout: 45_000 });
  await expect(editor.getByRole("button", { name: "Use built-in table" })).toBeVisible();

  // A likely typo is flagged on its row and in the summary.
  await editor.getByRole("textbox", { name: "Flush pays per coin", exact: true }).fill("12");
  await expect(editor.getByText("Flush pays more than Full House at max bet. Check for a typo.").first()).toBeVisible();

  // Pasted lines fill matching hands.
  await editor.getByText("Paste a pay table", { exact: true }).click();
  await editor.getByRole("textbox", { name: "Pasted pay table" }).fill("Full House 7\nFlush 5\nMystery 3");
  await editor.getByRole("button", { name: "Read pasted text" }).click();
  await expect(editor.getByText(/Filled 2 hands\. Couldn't read: “Mystery 3”/)).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Full House pays per coin", exact: true })).toHaveValue("7");
  await expect(editor.getByText("These pays match the built-in", { exact: false })).toHaveCount(0);
  await expect(editor.locator(".return-value")).toHaveText(/^\d+\.\d\d%$/, { timeout: 45_000 });
  await expect(editor.getByRole("textbox", { name: "Pay table name" })).toHaveAttribute("placeholder", "7/5 Jacks or Better");
  await editor.getByRole("button", { name: "Save pay table", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Pay table “7/5 Jacks or Better” saved.")).toBeVisible();
  await expect(page.locator(".paytables-panel")).toContainText("7/5 Jacks or Better");
  await expect(page.locator(".paytables-panel")).toContainText("not used yet");

  // The machine sheet offers the custom table, and can enter another one in place.
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await page.getByRole("button", { name: "New machine" }).first().click();
  await page.getByRole("button", { name: /^Build your own/ }).click();
  await page.getByRole("button", { name: "Enter a pay table…" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Pay table shorthand" }).fill("9/5");
  await page.getByRole("dialog").getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog").locator(".return-value")).toHaveText(/^\d+\.\d\d%$/, { timeout: 45_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Save pay table", exact: true }).click();
  const payTables = page.getByRole("radiogroup", { name: "Pay table" });
  await expect(payTables.getByRole("radio", { name: /9\/5 Jacks or Better/ })).toHaveAttribute("aria-checked", "true");
  await payTables.getByRole("radio", { name: /7\/5 Jacks or Better/ }).click();
  await page.getByRole("textbox", { name: "Machine name", exact: true }).fill("Seven Five");
  await page.getByRole("button", { name: "Add machine", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Seven Five" })).toContainText("7/5 Jacks or Better");
  await expect(page.getByRole("article", { name: "Seven Five" })).toContainText(/\d+\.\d\d% return/);

  // A custom table plays like any other: dealt, analysed and shown on the machine screen.
  await page.getByRole("article", { name: "Seven Five" }).getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("region", { name: "7/5 Jacks or Better pay table" })).toBeVisible();
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled({ timeout: 30_000 });
  // Its full analysis has no static asset: the worker computes it on first request, then caches it.
  await page.getByText("Optional table analysis", { exact: true }).click();
  await expect(page.locator(".analysis-stat").filter({ hasText: "Computed return" }).locator("strong")).toHaveText(/^\d+\.\d{3}%$/, { timeout: 90_000 });

  // It cannot be deleted while a machine uses it.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "More actions for 7/5 Jacks or Better" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete pay table" }).click();
  await expect(page.getByText("“Seven Five” uses this pay table. Change or delete it first.")).toBeVisible();
  await expect(page.locator(".paytables-panel")).toContainText("used by 1 machine");
  expect(errors).toEqual([]);
});
