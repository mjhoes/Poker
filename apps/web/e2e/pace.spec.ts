import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createPlayTable } from "./play-helpers";

/** An evening at sea; the trip's needed pace depends on the casino hours left from here. */
const START = new Date("2026-12-01T19:00:00");

async function playHand(page: Page) {
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  const draw = page.getByRole("button", { name: "Draw", exact: true });
  await expect(draw).toBeEnabled();
  await draw.click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeEnabled();
}

test("Casino-Pace Mode: the trip's needed pace as the target, a quiet timed session, then speed against mistakes", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: START });
  await createPlayTable(page, { amount: "500" }); // a 25¢ × 5 machine ($1.25 a hand)

  // A four-day trip from tonight: 6 casino hours a day, so 24 h left. 2,500 points = $37,500 = 30,000 hands → 1,250/hr.
  await page.getByRole("link", { name: "Cruise", exact: true }).click();
  await page.getByRole("button", { name: "Plan a trip" }).click();
  await page.getByRole("textbox", { name: "Ship or trip name" }).fill("Wonder of the Seas");
  await page.getByLabel("Sail date").fill("2026-12-01");
  await page.getByLabel("Return date").fill("2026-12-04");
  await page.getByRole("button", { name: "Plan trip" }).click();
  const panel = page.getByRole("region", { name: "Speed against mistakes" });
  await expect(panel).toContainText("Play Free Play or a pace session");

  await panel.getByRole("button", { name: "Train your pace" }).click();
  const dialog = page.getByRole("dialog", { name: "Train your pace" });
  await expect(dialog.getByLabel("Target hands per hour")).toHaveValue("1250");
  await expect(dialog).toContainText("Your trip needs about 1,250 hands/hr at $1.25 a hand to reach its target in the 24 h left.");
  await expect(dialog.getByRole("radio", { name: "99.9%" })).toHaveAttribute("aria-checked", "true"); // the sensible default
  await expect(dialog.getByRole("radio", { name: "Quiet" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: "99.8%" }).click();
  await dialog.getByRole("button", { name: "Start pace session" }).click();

  // The session room: full Free Play hands, timed; quiet feedback keeps accuracy until the end.
  const meter = page.getByRole("region", { name: "Casino pace" });
  await expect(page.locator(".session-eyebrow")).toContainText("Casino pace");
  await expect(meter).toContainText("Target 1,250 hands/hr");
  await expect(meter).toContainText("99.80% of perfect play's EV");
  await expect(meter).toContainText("Accuracy shows when you close the session");
  for (let hand = 0; hand < 7; hand++) await playHand(page); // drawing five every time: mostly mistakes
  await expect(meter.getByRole("meter", { name: "Pace against target" })).toHaveAttribute("aria-valuetext", /hands per hour; target 1,250$/);
  await expect(meter.getByText("On pace")).toBeVisible(); // a hand every second or so is far faster than 1,250/hr
  await expect(page.locator(".play-topline .pace-chip")).toHaveAttribute("aria-label", /^Pace [\d,]+ hands per hour; target 1,250$/); // in view while playing
  await expect(meter).not.toContainText("EV kept");

  await page.getByRole("button", { name: "Close session" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close session" }).click();
  await expect(meter).toContainText("hands/hr this session");
  await expect(meter).toContainText(/EV kept\d+\.\d\d% · below your bar/);

  // The trade-off on the Cruise page: those hands sit in the fastest band, too few to call a best pace.
  await page.getByRole("link", { name: "Cruise", exact: true }).click();
  const row = panel.getByRole("row").filter({ hasText: "1,100+" });
  await expect(row).toContainText("6few hands"); // 7 hands, 6 with a pace (the first has none)
  await expect(panel).toContainText("None of your speeds keeps 99.8% over 50+ hands yet.");
  await expect(row.getByRole("cell").nth(5)).toHaveText(/^\d+(\.\d)? h$/); // hours to the trip's target at that pace
  expect(errors).toEqual([]);
});
