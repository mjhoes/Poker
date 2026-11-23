import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Deterministic tour of the main interface states. Deals come from crypto.getRandomValues inside the engine worker, so
 * the worker script is served with a seeded generator in front of it; the page clock is fixed so dates never change.
 */
const SEED_SHIM = `{
  let state = 0x2545F491;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  crypto.getRandomValues = array => { for (let i = 0; i < array.length; i++) array[i] = next() % (2 ** (8 * array.BYTES_PER_ELEMENT)); return array; };
}
`;

async function seededPage(page: Page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date("2026-03-14T19:30:00Z"));
  await page.route(/engine\.worker\.ts/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: SEED_SHIM + await response.text() });
  });
}
async function settle(page: Page) {
  // Toasts are transient; close them so they never land in a baseline.
  for (const close of await page.getByRole("button", { name: "Dismiss notification" }).all()) await close.click().catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}
async function shot(page: Page, name: string, fullPage = true) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage });
}
async function addWallet(page: Page) {
  await page.getByRole("link", { name: "Wallets", exact: true }).click();
  await page.getByRole("button", { name: "Set up a wallet", exact: true }).click();
  await page.getByRole("textbox", { name: "Wallet name", exact: true }).fill("Cruise bankroll");
  await page.getByRole("textbox", { name: "Starting balance", exact: true }).fill("500");
}
async function addMachine(page: Page, name: string, lines: string, felt: string, game?: string) {
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await page.getByRole("button", { name: "New machine" }).first().click();
  if (game) await page.getByRole("radiogroup", { name: "Game" }).getByRole("radio", { name: new RegExp(`^${game}`) }).click();
  await page.getByRole("textbox", { name: "Machine name", exact: true }).fill(name);
  await page.getByRole("radiogroup", { name: "Lines" }).getByRole("radio", { name: `${lines} line${lines === "1" ? "" : "s"}` }).click();
  await page.getByRole("radio", { name: felt }).click();
}
async function saveMachine(page: Page) {
  await page.getByRole("button", { name: "Add machine", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function startSession(page: Page, machine: string, mode: "free_play" | "drill" = "free_play") {
  await page.getByRole("article", { name: machine }).getByRole("button", { name: mode === "drill" ? "Drill" : "Play", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
}
async function dealHand(page: Page) {
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: /^(Draw|Check answer)$/ })).toBeEnabled();
}

test("desktop tour: setup, machines, Free Play, review, settlement and report", async ({ page }) => {
  await seededPage(page);
  await page.goto("/");
  await shot(page, "01-welcome");
  await addWallet(page);
  await shot(page, "02-new-wallet-dialog", false);
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await shot(page, "03-wallets");
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await shot(page, "03b-starter-machines");
  await addMachine(page, "Quarter Jacks", "1", "Casino green");
  await page.locator(".modal").evaluate(element => { element.scrollTop = 0; }); // Typing the name scrolled the sheet.
  await shot(page, "04-new-machine-dialog", false);
  await saveMachine(page);
  await addMachine(page, "Midnight Triple", "3", "Midnight blue");
  await saveMachine(page);
  await addMachine(page, "Purple Deuces", "1", "Royal purple", "Deuces Wild");
  await saveMachine(page);
  await shot(page, "05-machines");
  await page.getByRole("button", { name: "More actions for Quarter Jacks" }).click();
  await shot(page, "05b-machine-menu", false);
  await page.keyboard.press("Escape");
  await startSession(page, "Midnight Triple");
  await shot(page, "06-session-ready-midnight");
  await page.getByRole("button", { name: "Table settings", exact: true }).click();
  await shot(page, "06b-table-settings", false);
  await page.keyboard.press("Escape");
  await dealHand(page);
  await shot(page, "07-dealt-hand");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hold review" })).toBeVisible();
  await shot(page, "08-hold-review");
  await page.getByRole("button", { name: "Draw anyway", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  await shot(page, "09-settled-three-lines");
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  await shot(page, "10-close-dialog", false);
  await page.getByRole("dialog").getByRole("button", { name: "Close session", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await shot(page, "11-closed-report");
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await shot(page, "11b-machines-after-play");
  await page.getByRole("button", { name: "More actions for Quarter Jacks" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await shot(page, "12-delete-dialog", false);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await shot(page, "13-settings");
  await page.getByRole("link", { name: "Statistics", exact: true }).click();
  await expect(page.locator(".stats-page")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot(page, "14-statistics");
});

test("classic felt Rapid Drill with optimal feedback", async ({ page }) => {
  await seededPage(page);
  await page.goto("/");
  await addWallet(page);
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await addMachine(page, "Burgundy Bonus", "1", "Classic burgundy");
  await saveMachine(page);
  await startSession(page, "Burgundy Bonus", "drill");
  await dealHand(page);
  await shot(page, "15-drill-dealt-classic");
  // Choose the engine's best hold so the optimal-feedback state is captured.
  const best = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/state/app-store.ts" as string) as typeof import("../src/state/app-store");
    const state = useAppStore.getState();
    return state.sessions[state.activeSessionId!].state.analysis!.best.mask;
  });
  const cards = page.getByRole("group", { name: "Current poker hand. Select cards to hold." }).getByRole("button");
  for (let index = 0; index < 5; index++) {
    if ((await cards.nth(index).getAttribute("aria-pressed") === "true") !== !!(best & (1 << index))) await cards.nth(index).click();
  }
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Optimal hold" })).toBeVisible();
  await shot(page, "16-drill-optimal-classic");
});

async function bestMask(page: Page) {
  return page.evaluate(async () => {
    const { useAppStore } = await import("/src/state/app-store.ts" as string) as typeof import("../src/state/app-store");
    const state = useAppStore.getState();
    return state.sessions[state.activeSessionId!].state.analysis!.best.mask;
  });
}
async function holdMask(page: Page, mask: number) {
  const cards = page.getByRole("group", { name: "Current poker hand. Select cards to hold." }).getByRole("button");
  for (let index = 0; index < 5; index++) {
    if ((await cards.nth(index).getAttribute("aria-pressed") === "true") !== !!(mask & (1 << index))) await cards.nth(index).click();
  }
}

test("ten-line Free Play settles every line on the table", async ({ page }) => {
  await seededPage(page);
  await page.goto("/");
  await addWallet(page);
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await addMachine(page, "Ten Play Jacks", "10", "Ocean teal");
  await saveMachine(page);
  await startSession(page, "Ten Play Jacks");
  await dealHand(page);
  await holdMask(page, await bestMask(page));
  await shot(page, "20-ten-line-holding");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  await shot(page, "21-ten-line-settled");
});

test("phone layouts: first run, starter machine and play", async ({ page }) => {
  await seededPage(page, { width: 390, height: 844 });
  await page.goto("/");
  await shot(page, "17-phone-welcome");
  await page.getByRole("button", { name: /^Start with/ }).click();
  await expect(page.getByRole("heading", { name: "Pick your first machine." })).toBeVisible();
  await shot(page, "17b-phone-starters");
  await page.getByRole("button", { name: "Add 9/6 Jacks or Better" }).click();
  await expect(page.getByRole("heading", { name: "Pick a machine." })).toBeVisible();
  await shot(page, "18-phone-machines");
  await page.getByRole("button", { name: "New machine" }).first().click();
  await shot(page, "18b-phone-new-machine");
  await page.keyboard.press("Escape");
  await startSession(page, "9/6 Jacks or Better · 25¢");
  await dealHand(page);
  await shot(page, "19-phone-dealt");
  await holdMask(page, await bestMask(page));
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  await shot(page, "19b-phone-settled");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
