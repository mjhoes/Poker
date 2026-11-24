import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Records } from "@perfect-draw/shared";

/** One click on the first machine's Play (or Continue) or Drill button opens the session room. */
export async function preparePlaySession(page: Page, mode: "free_play" | "drill" = "free_play") {
  await page.getByRole("button", { name: mode === "drill" ? /^Drill$/ : /^(Play|Continue)$/ }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
}
export async function createPlayTable(page: Page, options: { mode?: "free_play" | "drill"; lines?: number; amount?: string } = {}) {
  await page.goto("/");
  await page.getByRole("link", { name: "Wallets", exact: true }).click();
  await page.getByRole("button", { name: "Set up a wallet", exact: true }).click();
  await page.getByRole("textbox", { name: "Wallet name", exact: true }).fill("Play test wallet");
  await page.getByRole("textbox", { name: "Starting balance", exact: true }).fill(options.amount ?? "100");
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await page.getByRole("button", { name: /New machine|Create.*machine/i }).first().click();
  await page.getByRole("button", { name: /^Build your own/ }).click();
  await page.getByRole("textbox", { name: "Machine name", exact: true }).fill("Play test table");
  const lines = options.lines ?? 1;
  await page.getByRole("radiogroup", { name: "Lines" }).getByRole("radio", { name: `${lines} line${lines === 1 ? "" : "s"}` }).click();
  await page.getByRole("button", { name: "Add machine", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await preparePlaySession(page, options.mode);
}
/** Read-only audit of persisted data, also usable against the offline production bundle. */
export async function readPlayState(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("perfect-draw");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const names = ["sessions", "decisions", "wallets", "walletLedger"] as const;
      const transaction = database.transaction([...names], "readonly");
      const results = await Promise.all(names.map(name => new Promise<unknown[]>((resolve, reject) => {
        const get = transaction.objectStore(name).getAll();
        get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error);
      })));
      return { sessions: results[0] as Records["sessions"][], decisions: results[1] as Records["decisions"][],
        wallets: results[2] as Records["wallets"][], ledger: results[3] as Records["walletLedger"][] };
    } finally { database.close(); }
  });
}
export async function chooseMask(page: Page, mask: number) {
  const cards = page.getByRole("group", { name: "Current poker hand. Select cards to hold." }).getByRole("button");
  for (let index = 0; index < 5; index++) {
    const desired = !!(mask & (1 << index));
    if ((await cards.nth(index).getAttribute("aria-pressed") === "true") !== desired) {
      await cards.nth(index).click();
      await expect(cards.nth(index)).toHaveAttribute("aria-pressed", String(desired));
    }
  }
}
