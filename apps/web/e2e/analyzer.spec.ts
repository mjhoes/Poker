import { expect, test } from "@playwright/test";
import { chooseMask, createPlayTable, readPlayState } from "./play-helpers";

test("analyze a typed hand: ranked holds, why, chart line, other tables, what I held, address and recent hands", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Analyze", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Analyze a hand" })).toBeVisible();

  const text = page.getByRole("textbox", { name: "Type a hand" });
  await text.fill("7c 7c");
  await expect(page.getByRole("alert")).toHaveText("Two cards are the 7 of clubs.");
  await text.fill("As Ac 8d 8h 3c");
  const results = page.getByRole("region", { name: "Holds ranked" });
  // 9/6 Jacks or Better: keep the two pair.
  await expect(results.getByRole("heading", { level: 2 })).toContainText("A♠ A♣ 8♦ 8♥");
  const holds = results.getByRole("list", { name: "All holds, best first" }).getByRole("listitem");
  await expect(holds).toHaveCount(8);
  await results.getByRole("button", { name: "Show all 32 holds" }).click();
  await expect(holds).toHaveCount(32);
  // The runner-up is compared by default; the Why? panel explains it.
  await expect(results.getByRole("region", { name: "Why the best hold is better" }).locator(".why-summary")).toContainText("Full House");

  // Strategy chart: Expert by default, with Beginner and Intermediate.
  const chart = page.getByRole("region", { name: "Strategy chart" });
  await expect(chart.locator(".citation-where")).toContainText(/^Expert chart · line \d+ of \d+$/, { timeout: 45_000 });
  await expect(chart.locator(".citation-agrees")).toHaveText("This is the best hold.");
  await chart.getByRole("button", { name: "Beginner", exact: true }).click();
  await expect(chart.locator(".citation-where")).toContainText(/^Beginner chart · line/, { timeout: 45_000 });

  // Other tables: Double Double Bonus throws the eights to chase four aces.
  const across = page.getByRole("region", { name: "Across pay tables" });
  const ddb = across.getByRole("listitem").filter({ hasText: "9/6 Double Double Bonus" });
  await expect(ddb).toContainText("Different");
  await expect(ddb).toContainText("A♠ A♣");
  await expect(across.getByRole("listitem").filter({ hasText: "9/6 Jacks or Better" })).toHaveCount(0); // the selected table

  // Switching the table changes the answer; below max bet there is no chart.
  await page.getByRole("combobox", { name: "Machine or pay table" }).selectOption({ label: "9/6 Double Double Bonus" });
  await expect(results.getByRole("heading", { level: 2 })).toHaveText(/^A♠ A♣ · /);
  await page.getByRole("radiogroup", { name: "Bet (coins per line)" }).getByRole("radio", { name: "1 coin" }).click();
  await expect(chart).toContainText("Strategy charts are for max bet.");
  await page.getByRole("radiogroup", { name: "Bet (coins per line)" }).getByRole("radio", { name: "5 coins" }).click();

  // What I held: kept the two pair on Double Double Bonus.
  await results.getByRole("button", { name: "What I held…" }).click();
  for (const name of ["A of spades", "A of clubs", "8 of diamonds", "8 of hearts"]) await page.getByRole("button", { name: `${name}, not kept` }).click();
  await results.getByRole("button", { name: "Done", exact: true }).click();
  await expect(results.locator(".analyzer-mine")).toContainText(/What you held costs \d+\.\d{3} credits per line/);
  await expect(results.locator(".hold-badge.is-mine")).toBeVisible();
  await expect(results.getByRole("heading", { level: 3 })).toHaveText("Why the best hold beats what you held");

  // The address keeps the hand, table, bet and hold; a reload reopens it.
  await expect(page).toHaveURL(/#\/analyze\?hand=AsAc8d8h3c&table=[a-f0-9]{64}&bet=5&held=15$/);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Type a hand" })).toHaveValue("As Ac 8d 8h 3c");
  await expect(page.getByRole("combobox", { name: "Machine or pay table" })).toHaveValue(/^table:/);
  await expect(page.getByRole("region", { name: "Holds ranked" }).locator(".analyzer-mine")).toContainText("What you held costs");

  // Recent hands reopen a hand.
  const recent = page.getByRole("region", { name: "Recent hands" });
  await expect(recent.getByRole("button", { name: /^Open A♠ A♣ 8♦ 8♥ 3♣, 9\/6 Double Double Bonus/ })).toBeVisible();
  await page.getByRole("region", { name: "Hand", exact: true }).getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Type a hand" })).toHaveValue("");
  await recent.getByRole("button", { name: /^Open A♠ A♣ 8♦ 8♥ 3♣, 9\/6 Jacks or Better/ }).click();
  await expect(page.getByRole("textbox", { name: "Type a hand" })).toHaveValue("As Ac 8d 8h 3c");
  await expect(page.getByRole("combobox", { name: "Machine or pay table" })).toHaveValue(/^table:/);
  await expect(page.getByRole("region", { name: "Holds ranked" }).getByRole("heading", { level: 2 })).toContainText("A♠ A♣ 8♦ 8♥");
  expect(errors).toEqual([]);
});

test("pick cards from the deck by mouse and keyboard", async ({ page }) => {
  await page.goto("/#/analyze");
  const deck = page.getByRole("group", { name: "Deck: pick five cards" });
  await deck.getByRole("button", { name: "A of spades" }).click();
  await deck.getByRole("button", { name: "K of spades" }).click();
  await expect(deck.getByRole("button", { name: "A of spades" })).toHaveAttribute("aria-pressed", "true");
  // Arrow keys move through the deck; Enter picks.
  await deck.getByRole("button", { name: "K of spades" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Type a hand" })).toHaveValue("As Ks Qs Js Jh");
  // A full hand disables the rest of the deck; a picked card removes itself.
  await expect(deck.getByRole("button", { name: "2 of clubs" })).toBeDisabled();
  await deck.getByRole("button", { name: "J of hearts" }).click();
  await deck.getByRole("button", { name: "10 of spades" }).click();
  await expect(page.getByRole("region", { name: "Holds ranked" }).getByRole("heading", { level: 2 })).toContainText("A♠ K♠ Q♠ J♠ 10♠");
});

test("on a phone, cards are picked by rank then suit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/analyze");
  await expect(page.getByRole("group", { name: "Deck: pick five cards" })).toBeHidden();
  for (const [rank, card] of [["A", "A of hearts"], ["K", "K of hearts"], ["Q", "Q of hearts"], ["J", "J of hearts"], ["2", "2 of clubs"]]) {
    await page.getByRole("group", { name: "Rank" }).getByRole("button", { name: rank, exact: true }).click();
    await page.getByRole("group", { name: "Suit" }).getByRole("button", { name: card }).click();
  }
  await expect(page.getByRole("textbox", { name: "Type a hand" })).toHaveValue("Ah Kh Qh Jh 2c");
  await expect(page.getByRole("region", { name: "Holds ranked" }).getByRole("heading", { level: 2 })).toContainText("A♥ K♥ Q♥ J♥");
});

test("a played hand opens in the analyzer with what was held", async ({ page }) => {
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
  await page.getByRole("link", { name: "Open in analyzer" }).click();
  await expect(page.getByRole("heading", { name: "Analyze a hand" })).toBeVisible();
  // The session's machine is selected, so values also show in dollars.
  await expect(page.getByRole("combobox", { name: "Machine or pay table" })).toHaveValue(/^machine:/);
  const results = page.getByRole("region", { name: "Holds ranked" });
  await expect(results.locator(".analyzer-mine")).toContainText("What you held costs");
  await expect(results.locator(".analyzer-best-value")).toContainText(analysis.best.ev.toFixed(3));
  await expect(results.locator(".analyzer-best-value .analyzer-dollars")).toContainText("$");
});
