import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chooseMask, createPlayTable, readPlayState } from "./play-helpers";

/** Deal a Rapid Drill hand and answer it: with the best hold, or by drawing five (often a mistake). */
async function drillHand(page: Page, best: boolean) {
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  const check = page.getByRole("button", { name: "Check answer", exact: true });
  await expect(check).toBeEnabled();
  if (best) {
    const state = await readPlayState(page);
    const session = state.sessions.filter(row => row.status !== "closed").sort((a, b) => b.updatedAt - a.updatedAt)[0];
    await chooseMask(page, session.state.analysis!.best.mask);
  }
  await check.click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeEnabled();
}
const openSession = async (page: Page) => (await readPlayState(page)).sessions.filter(row => row.status !== "closed").sort((a, b) => b.startedAt - a.startedAt)[0];

test("adaptive training: cards from play, today's review to all caught up, the cap, close calls and the weakness trainer", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  // Fake time starts at the real time: the engine worker keeps the real clock, and Statistics ignores "future" hands.
  await page.clock.install();
  await createPlayTable(page, { mode: "drill" });
  for (let hand = 0; hand < 8; hand++) await drillHand(page, false);
  const mistakes = (await readPlayState(page)).decisions.filter(row => row.evLoss > 1e-9).length;
  expect(mistakes).toBeGreaterThan(0);

  // Every hand made or updated a card; mistakes come back in 10 minutes. Only review sessions use the daily cap.
  await page.getByRole("link", { name: "Train", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nothing due now" })).toBeVisible();
  await expect(page.getByText("0 of 50 reviewed today (all games)")).toBeVisible();
  const cards = page.getByRole("table").last().getByRole("row");
  await expect(cards.nth(1)).toBeVisible();
  await expect(page.getByRole("table").last()).toContainText("In 10 min");

  // The cap is adjustable.
  await page.getByLabel("Reviews a day").fill("20");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("0 of 20 reviewed today (all games)")).toBeVisible();

  // Eleven minutes later the mistakes are due: review them, right this time, until all caught up.
  await page.clock.fastForward(11 * 60_000);
  await page.reload();
  const start = page.getByRole("button", { name: /^Start review \(\d+\)$/ });
  await expect(start).toBeVisible();
  const due = Number((await start.textContent())!.match(/\d+/)![0]);
  await start.click();
  const note = page.getByRole("region", { name: "Training plan" });
  await expect(page.locator(".session-eyebrow")).toContainText("Review");
  await expect(note).toContainText(`${due} left today`);
  for (let hand = 0; hand < due; hand++) await drillHand(page, true);
  await expect(note).toContainText("All caught up");
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Nothing else is due for review on this table right now.");

  await page.getByRole("link", { name: "Train", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nothing due now" })).toBeVisible();
  await expect(page.getByText(`${due} of 20 reviewed today (all games)`)).toBeVisible();

  // Close calls: every hand's best two holds are within the slider's gap (0.10 credits per coin × 5 coins).
  await page.getByRole("button", { name: "Start Close Calls" }).click();
  await expect(page.locator(".session-eyebrow")).toContainText("Close Calls");
  for (let hand = 0; hand < 3; hand++) {
    await page.getByRole("button", { name: "Deal hand", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check answer", exact: true })).toBeEnabled();
    expect((await openSession(page)).state.analysis!.gapToSecond).toBeLessThanOrEqual(0.5 + 1e-9);
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeEnabled();
  }

  // The Weakness Trainer starts from your costliest mistakes on this table.
  await page.getByRole("link", { name: "Train", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your costliest mistakes" }).getByRole("listitem").first()).toBeVisible();
  await page.getByRole("button", { name: "Start Weakness Trainer" }).click();
  await expect(page.locator(".session-eyebrow")).toContainText("Weakness Trainer");
  await expect(page.getByRole("region", { name: "Training plan" })).toContainText("Your costliest mistakes");
  await drillHand(page, true);
  expect((await openSession(page)).training?.targets?.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("quiet feedback stays quiet on Train: an open quiet session's cards show no results until it closes", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await createPlayTable(page);
  await page.getByRole("button", { name: "Table settings", exact: true }).click();
  await page.getByRole("button", { name: "Silent report", exact: true }).click();
  await expect(page.getByRole("button", { name: "Silent report", exact: true })).toHaveAttribute("aria-pressed", "true");
  // One hand, held wrong on purpose.
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  const analysis = (await openSession(page)).state.analysis!;
  await chooseMask(page, analysis.results.find(result => result.ev < analysis.best.ev - 1e-9)!.mask);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeEnabled();
  expect((await openSession(page)).state.feedbackMode).toBe("silent_report");

  // Before closing: the card is there, but not its result or its 10-minute relearn, and the Weakness Trainer doesn't
  // list the mistake (PR #9 reviews).
  await page.getByRole("link", { name: "Train", exact: true }).click();
  const cards = page.getByRole("region", { name: "Every best-hold category you've played" });
  await expect(cards).toContainText("1 card holds hands from an open session with quiet feedback. Its results show here when you close it.");
  const row = cards.getByRole("row").nth(1);
  await expect(row).toContainText("Hidden");
  await expect(row).toContainText("After your quiet session");
  await expect(row).not.toContainText("0 of 1");
  await expect(row).not.toContainText("In 10 min");
  const weakness = page.getByRole("region", { name: "Your costliest mistakes" });
  await expect(weakness).toContainText("No costly mistakes on this table yet.");
  await expect(weakness).toContainText("Hands from your open session with quiet feedback join this list when you close it.");
  await expect(weakness.getByRole("listitem")).toHaveCount(0);

  // Close it while Train stays open: the cards and the weakness list catch up without leaving the page.
  const quietId = (await openSession(page)).id;
  await page.evaluate(async id => {
    const { sessionService } = await import("/src/services/sessions.ts" as string) as typeof import("../src/services/sessions");
    await sessionService.close(id);
  }, quietId);
  await expect(row).toContainText("0 of 1");
  await expect(row).toContainText("In 10 min");
  await expect(cards).not.toContainText("open session with quiet feedback");
  await expect(weakness.getByRole("listitem")).toHaveCount(1);
  await expect(weakness).not.toContainText("join this list when you close it");
  expect(errors).toEqual([]);
});
