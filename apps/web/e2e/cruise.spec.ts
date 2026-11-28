import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** A fixed evening at sea; the timer is driven by Playwright's clock instead of waiting. */
const START = new Date("2026-12-01T19:00:00");

async function planTrip(page: Page) {
  await page.clock.install({ time: START });
  await page.goto("/#/cruise");
  await page.getByRole("button", { name: "Plan a trip" }).click();
  await page.getByRole("textbox", { name: "Ship or trip name" }).fill("Wonder of the Seas");
  await page.getByLabel("Sail date").fill("2026-12-01");
  await page.getByLabel("Return date").fill("2026-12-04");
  await expect(page.getByRole("group", { name: /Casino hours by day · 24 h planned/ })).toBeVisible();
  await page.getByLabel("Wed, Dec 2 day type").selectOption("port");
  await expect(page.getByLabel("Wed, Dec 2 casino hours")).toHaveValue("2");
  await page.getByRole("button", { name: "Plan trip" }).click();
  await expect(page.getByRole("heading", { name: "2,500 points to go." })).toBeVisible();
  // The planner shows the game's return once the engine has it (slow the first time the dev server builds the worker).
  await expect(page.getByText(/^Return 99\.54% at perfect play/)).toBeVisible({ timeout: 60_000 });
}
async function startSession(page: Page) {
  await page.getByRole("button", { name: "Start casino session" }).click();
  const dialog = page.getByRole("dialog", { name: "Start a casino session" });
  await dialog.getByLabel("Game", { exact: true }).selectOption({ label: "9/6 Jacks or Better" });
  await dialog.getByLabel("Denomination", { exact: true }).fill("0.25");
  await dialog.getByLabel("Cash in").fill("300");
  await dialog.getByLabel("Points on the machine now").fill("1,200");
  await dialog.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("timer")).toHaveText("0:00:00");
}

test("a casino session: timed from timestamps through a pause and a reload, then coin-in and cost from two point readings", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await planTrip(page);
  await startSession(page);
  const live = page.getByRole("region", { name: "Casino session" });
  await expect(live).toContainText("9/6 Jacks or Better · 25¢ × 5 = $1.25 a hand");

  await page.clock.fastForward(30 * 60_000);
  await expect(page.getByRole("timer")).toHaveText("0:30:00");
  await live.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("radio", { name: "Hand pay" }).click();
  await page.getByLabel("Hand pay amount").fill("1250");
  await page.getByRole("dialog").getByRole("button", { name: "Pause" }).click();
  await expect(live).toContainText("PAUSED");
  await expect(live).toContainText("Hand pays$1,250.00");

  // Paused time isn't play, and the session survives a reload: it is all timestamps in the database.
  await page.clock.fastForward(15 * 60_000);
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText("0:30:00");
  // Let the engine answer before the next jump: jumping the fake clock also fires its 3-minute request timeout.
  await expect(page.getByText(/^Return 99\.54% at perfect play/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("region", { name: "Casino session" }).getByRole("button", { name: "Resume" }).click();
  // The resume is stamped when the app handles the click: wait for it before moving the clock, or the jump counts as paused.
  await expect(live).not.toContainText("PAUSED");
  await page.clock.fastForward(30 * 60_000);
  await expect(page.getByRole("timer")).toHaveText("1:00:00");

  await live.getByRole("button", { name: "Add cash" }).click();
  await page.getByLabel("Cash amount").fill("100");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(live).toContainText("Cash in$400.00");
  await live.getByRole("button", { name: "Points now" }).click();
  await page.getByLabel("Points on the machine").fill("1250");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(live).toContainText("1,200 → 1,250 (+50)");
  await expect(live).toContainText("Coin-in so far$750.00");

  await live.getByRole("button", { name: "Cash out" }).click();
  const dialog = page.getByRole("dialog", { name: "Cash out" });
  await dialog.getByRole("textbox", { name: "Cash out amount" }).fill("1420");
  await dialog.getByLabel("Points at cash-out").fill("1300");
  await expect(dialog).toContainText("$1,500.00 from points (within $15.00)");
  await expect(dialog).toContainText("Points earned100");
  await expect(dialog).toContainText("Net result+$1,020.00");
  await dialog.getByRole("button", { name: "Cash out" }).click();
  await expect(page.getByRole("region", { name: "Casino session" })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "2,400 points to go." })).toBeVisible();
  const trip = page.getByRole("region", { name: "Cost of a point" });
  await expect(trip).toContainText("Coin-in$1,500.00");
  await expect(trip).toContainText("Net result+$1,020.00");
  await expect(trip).toContainText("Cost per point−$10.20"); // ahead: a hand pay
  await expect(trip).toContainText("Theoretical cost per point$0.07"); // $15 × (1 − 99.54%)
  await expect(trip).toContainText("Active play1 h 00 min");
  await expect(trip).toContainText("Points per hour100.0");
  await expect(trip).toContainText("1,200 hands/hr");
  const row = page.getByRole("region", { name: "What each session cost" }).getByRole("row").nth(1);
  await expect(row).toContainText("$1,500.00from points");
  expect(errors).toEqual([]);
});

test("the planner reproduces the spec's worked example and shows the luck band", async ({ page }) => {
  await planTrip(page);
  const planner = page.getByRole("region", { name: "What the target takes" });
  await planner.getByLabel("Hands per hour").fill("700");
  await planner.getByLabel("Planner game").selectOption({ label: "9/6 Jacks or Better" });
  await planner.getByLabel("Planner denomination").selectOption({ label: "25¢" });
  await planner.getByLabel("Planner coins").selectOption("5");
  await expect(planner).toContainText("Coin-in needed$37,500.00");
  await expect(planner).toContainText("Hands at $1.2530,000");
  await expect(planner).toContainText("Hours at 700 hands/hr43 h");
  await expect(planner).toContainText("Expected cost$171.04");
  await expect(planner.getByText("Behind")).toBeVisible(); // 22 hours left from tonight
  await expect(planner.getByRole("img", { name: /^Results: 10th percentile −\$[\d,]+\.\d\d, median −\$[\d,]+\.\d\d, 90th percentile \+\$[\d,]+\.\d\d$/ })).toBeVisible();

  // $1 × 5: same cost, a quarter of the hands, and bigger swings.
  const band = async () => {
    const label = await planner.getByRole("img", { name: /^Results:/ }).getAttribute("aria-label");
    const [low, , high] = [...label!.matchAll(/([−+])\$([\d,]+\.\d\d)/g)].map(match => (match[1] === "−" ? -1 : 1) * Number(match[2].replace(/,/g, "")));
    return high - low;
  };
  const quarterSpread = await band();
  await planner.getByLabel("Planner denomination").selectOption({ label: "$1" });
  await expect(planner).toContainText("Hands at $5.007,500");
  await expect(planner).toContainText("Hours at 700 hands/hr11 h"); // 10.7 h, "~11 hours" in the spec
  await expect(planner).toContainText("Expected cost$171.04");
  await expect(planner.getByText("On track")).toBeVisible();
  await expect.poll(band).toBeGreaterThan(quarterSpread * 1.5);

  // Editing the trip updates the inputs left alone; the ones changed for "what if" stay (PR #7 review).
  await page.getByRole("button", { name: "Trip actions" }).click();
  await page.getByRole("menuitem", { name: "Edit trip and days" }).click();
  await page.getByLabel("Target points", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "5,000 points to go." })).toBeVisible();
  await expect(planner.getByLabel("Planner target points")).toHaveValue("5000");
  await expect(planner.getByLabel("Hands per hour")).toHaveValue("700");
  await expect(planner).toContainText("Coin-in needed$75,000.00");
  await planner.getByRole("button", { name: "Back to the trip's figures" }).click();
  await expect(planner.getByLabel("Hands per hour")).toHaveValue("600");
  await expect(planner.getByLabel("Planner denomination")).toHaveValue("25");
});

test("rewards, program rules and CSV export", async ({ page }) => {
  await planTrip(page);
  await startSession(page);
  await page.clock.fastForward(20 * 60_000);
  await page.getByRole("region", { name: "Casino session" }).getByRole("button", { name: "Cash out" }).click();
  const dialog = page.getByRole("dialog", { name: "Cash out" });
  await dialog.getByRole("textbox", { name: "Cash out amount" }).fill("200");
  await dialog.getByLabel("Points at cash-out").fill("1300");
  await dialog.getByRole("button", { name: "Cash out" }).click();
  const lifetime = page.getByRole("region", { name: "Lifetime" });
  await expect(lifetime).toContainText("Net result−$100.00");

  await lifetime.getByRole("button", { name: "Add reward" }).click();
  await page.getByLabel("Reward", { exact: true }).fill("Free balcony cruise");
  await page.getByLabel("Cash value").fill("1500");
  await page.getByRole("button", { name: "Add reward" }).last().click();
  await expect(lifetime).toContainText("Free balcony cruise");
  await expect(lifetime).toContainText("Rewards value$1,500.00");
  await expect(lifetime).toContainText("Cost per point after rewards−$14.00"); // ($100 − $1,500) ÷ 100
  await expect(lifetime).toContainText("Return on losses+1,400%");

  const download = page.waitForEvent("download");
  await lifetime.getByRole("button", { name: "Sessions CSV" }).click();
  const csv = await readFile(await (await download).path(), "utf8");
  expect(csv.split("\r\n")[0]).toContain("Coin-in,Coin-in from,Points earned");
  expect(csv).toContain(",1500.00,points,100,");

  // Program rules recalculate history: at $10 a point the same readings mean $1,000 of coin-in.
  await page.getByRole("button", { name: "Trip actions" }).click();
  await page.getByRole("menuitem", { name: "Program rules" }).click();
  await page.getByLabel("Coin-in per point").fill("10");
  await page.getByRole("button", { name: "Save program" }).click();
  await expect(page.getByRole("region", { name: "Cost of a point" })).toContainText("Coin-in$1,000.00");
});
