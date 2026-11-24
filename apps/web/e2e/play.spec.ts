import { expect, test } from "@playwright/test";
import { canonicalizeHand } from "@perfect-draw/engine";
import { decisionSchema } from "@perfect-draw/shared";
import { chooseMask, createPlayTable, preparePlaySession, readPlayState } from "./play-helpers";

test("whole credits retain cents, wallets use names and warning keyboards require an explicit click or changed hold", async ({ page }) => {
  await createPlayTable(page, { amount: "12.40" });
  await expect(page.locator(".session-chip")).toContainText("49 credits + $0.15");
  await expect(page.locator(".detail").filter({ hasText: /^Wallet/ })).toContainText("Play test wallet");
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  let session = (await readPlayState(page)).sessions[0];
  await chooseMask(page, session.state.analysis!.results.find(row => row.ev < session.state.analysis!.best.ev - 1e-9)!.mask);
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Draw anyway", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Draw anyway", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  const warned = await readPlayState(page);
  expect(warned.sessions[0].state.phase).toBe("holding");
  expect(warned.decisions).toHaveLength(1);
  expect(warned.wallets[0].balanceCents).toBe(1115);
  expect(warned.sessions[0].state).toMatchObject({ credits: 44, creditRemainderCents: 15 });
  await chooseMask(page, warned.sessions[0].state.analysis!.best.mask);
  await expect(page.getByRole("button", { name: "Draw anyway", exact: true })).toHaveCount(0);
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  session = (await readPlayState(page)).sessions[0];
  expect(session.summary).toMatchObject({ hands: 1, errors: 1 });
  await page.evaluate(async () => {
    const modulePath = "/src/data/db.ts";
    const { db } = await import(modulePath);
    const wallet = await db.records("wallets").toCollection().first();
    await db.records("wallets").update(wallet.id, { deletedAt: Date.now() });
  });
  await expect(page.locator(".detail").filter({ hasText: /^Wallet/ })).toContainText("Deleted wallet");
});
test("ten real Free Play hands preserve exact state, keyboard holds and multi-line accounting", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await createPlayTable(page, { lines: 3 });
  await page.getByRole("button", { name: "Table settings", exact: true }).click();
  await page.getByRole("button", { name: "Show after draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show after draw", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (let index = 0; index < 10; index++) {
    await page.getByRole("heading", { name: "Play test table", exact: true }).click();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
    const cards = page.getByRole("group", { name: "Current poker hand. Select cards to hold." }).getByRole("button");
    await page.keyboard.press("1");
    await expect(cards.nth(0)).toHaveAttribute("aria-pressed", "true");
    if (index % 3 === 0) {
      await page.keyboard.press("5");
      await expect(cards.nth(4)).toHaveAttribute("aria-pressed", "true");
    }
    let before = (await readPlayState(page)).sessions.find(row => row.mode === "free_play")!;
    if (index === 2) {
      await expect(page.getByRole("button", { name: "Close session", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
      const restored = (await readPlayState(page)).sessions.find(row => row.id === before.id)!;
      expect(restored.state.drawDecks).toEqual(before.state.drawDecks);
      expect(restored.state.hand).toEqual(before.state.hand);
      expect(restored.state.heldMask).toBe(before.state.heldMask);
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Machines", exact: true }).click();
      await preparePlaySession(page, "drill");
      await page.keyboard.press("Control+1");
      await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeVisible();
      before = (await readPlayState(page)).sessions.find(row => row.id === before.id)!;
      expect(before.state.heldMask).toBe(1);
    }
    await cards.nth(0).focus();
    await page.keyboard.press("Space"); // Must draw, not trigger the focused card's native click.
    await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
    const audit = await readPlayState(page);
    const session = audit.sessions.find(row => row.id === before.id)!;
    expect(session.summary.hands).toBe(index + 1);
    expect(session.state.outcome?.lines).toHaveLength(3);
    const row = audit.decisions.find(row => row.handId === before.state.handId)!;
    expect(decisionSchema.safeParse(row).success).toBe(true);
    const analysis = before.state.analysis!;
    const chosen = analysis.results.find(result => result.mask === before.state.heldMask)!;
    expect(row).toMatchObject({
      sessionId: session.id, paytableId: session.machineSnapshot.paytableId,
      variantKind: "standard", variantState: {},
      canonicalHandId: canonicalizeHand(analysis.hand).id, dealtCards: analysis.hand, chosenMask: before.state.heldMask,
      bestMask: analysis.best.mask, chosenEv: chosen.ev, bestEv: analysis.best.ev,
      chosenLabel: chosen.label, bestLabel: analysis.best.label, gapToSecond: analysis.gapToSecond,
      handIndexInSession: index + 1, isCorrection: false, coins: 5, lines: 3, denominationCents: 25,
    });
    expect(row.evLoss).toBeCloseTo(analysis.best.ev - chosen.ev, 9);
    expect(row.decisionMs).toBeGreaterThanOrEqual(0);
    expect(row.msSinceSessionStart).toBeGreaterThanOrEqual(row.decisionMs);
    if (index === 0) expect(row.priorOutcome).toBeNull();
    else expect(row.priorOutcome).toBeTruthy();
  }
  const audit = await readPlayState(page);
  const session = audit.sessions.find(row => row.mode === "free_play")!;
  expect(audit.decisions).toHaveLength(10);
  expect(audit.ledger.filter(row => row.type === "bet")).toHaveLength(10);
  expect(session.summary.coinInCents).toBe(3750);
  const won = audit.ledger.filter(row => row.type === "win").reduce((sum, row) => sum + row.amountCents, 0);
  expect(audit.wallets[0].balanceCents).toBe(10000 - 3750 + won);
  expect(session.summary.netCents).toBe(won - 3750);
  await page.reload();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  expect((await readPlayState(page)).sessions.find(row => row.id === session.id)!.state).toEqual(session.state);
  await page.screenshot({ path: "../../generated-artifacts/screenshots/free-play.jpg" });
  expect(errors).toEqual([]);
});

test("warnings survive reload, corrections keep the mistake, and silent play reports only on close", async ({ page }) => {
  await createPlayTable(page);
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  let session = (await readPlayState(page)).sessions[0];
  let analysis = session.state.analysis!;
  const wrong = analysis.results.find(result => result.ev < analysis.best.ev - 1e-9)!.mask;
  await chooseMask(page, wrong);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hold review", exact: true })).toBeVisible();
  expect((await readPlayState(page)).decisions).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hold review", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use best hold", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hold review", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Optimal hold", exact: true })).toBeVisible();
  const corrected = await readPlayState(page);
  expect(corrected.decisions).toHaveLength(2);
  expect(corrected.sessions[0].summary.errors).toBe(1);
  expect(corrected.decisions.filter(row => row.isCorrection)).toHaveLength(1);
  await page.getByRole("button", { name: "Table settings", exact: true }).click();
  await page.getByRole("button", { name: "Silent report", exact: true }).click();
  await expect(page.getByRole("button", { name: "Silent report", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Optimal hold", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Deal hand", exact: true }).click();
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  session = (await readPlayState(page)).sessions[0]; analysis = session.state.analysis!;
  await chooseMask(page, analysis.results.find(result => result.ev < analysis.best.ev - 1e-9)!.mask);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hold review", exact: true })).toHaveCount(0);
  await expect(page.getByText("Your hold · expected value", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Decision errors", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close session", exact: true }).click();
  const closeDialog = page.getByRole("dialog");
  await expect(closeDialog.getByRole("heading", { name: "Close this session?", exact: true })).toBeVisible();
  await expect(closeDialog.getByText("Hands", { exact: true })).toBeVisible();
  await closeDialog.getByRole("button", { name: "Close session", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How this session went", exact: true })).toBeVisible();
  const final = await readPlayState(page);
  expect(final.sessions[0].summary).toMatchObject({ hands: 2, errors: 2 });
  expect(final.sessions[0].summary.evLost).toBeGreaterThan(0);
  expect(final.decisions).toHaveLength(3);
  await expect(page.getByText("EV lost · all lines", { exact: true })).toBeVisible();
});

test("mobile Rapid Drill saves immediate keyboard feedback without wallet movements", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createPlayTable(page, { mode: "drill", amount: "0" });
  const latencies: number[] = [];
  for (let index = 0; index < 3; index++) {
    await page.getByRole("button", { name: "Deal hand", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check answer", exact: true })).toBeEnabled();
    const session = (await readPlayState(page)).sessions[0];
    await chooseMask(page, session.state.analysis!.best.mask);
    const latency = await page.evaluate(() => new Promise<number>((resolve, reject) => {
      const started = performance.now();
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error("Drill feedback never appeared")); }, 2000);
      const observer = new MutationObserver(() => {
        if ([...document.querySelectorAll("h3")].some(node => node.textContent === "Optimal hold")) {
          clearTimeout(timeout); observer.disconnect(); resolve(performance.now() - started);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }));
    latencies.push(latency);
    await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeVisible();
  }
  console.info(`Rapid Drill persisted-feedback timings: ${latencies.map(ms => ms.toFixed(1)).join(", ")} ms`);
  expect([...latencies].sort((a, b) => a - b)[1]).toBeLessThan(50);
  const audit = await readPlayState(page);
  expect(audit.decisions).toHaveLength(3);
  expect(audit.sessions[0].summary).toMatchObject({ hands: 3, errors: 0, coinInCents: 0, netCents: 0 });
  expect(audit.wallets[0].balanceCents).toBe(0);
  expect(audit.ledger).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "../../generated-artifacts/screenshots/rapid-drill-mobile.jpg" });
});
