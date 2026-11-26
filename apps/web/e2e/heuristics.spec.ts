import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import type { Page, Route } from "@playwright/test";
import { createPlayTable } from "./play-helpers";

/*
 * Heuristics: cards from your mistakes, the Rule Lab, and AI polish and plain English against an intercepted Anthropic
 * API (no real key, no real call). The fake model reads the request: it rewords a card keeping one sentence per
 * exception; reading its own rewording back, it gives the Rule Lab card's rule; and it turns any other plain-English rule
 * into "4 to a flush over a low pair". `gate`, when given, holds each plain-English reading until it resolves.
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
async function mockAnthropic(page: Page, gate?: () => Promise<void>) {
  const calls: string[] = [];
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (request.url().includes("/v1/models")) return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) });
    const body = request.postDataJSON() as { model: string; system: unknown; messages: { content: string | { type: string; text?: string }[] }[] };
    const system = JSON.stringify(body.system);
    const content = body.messages[0].content;
    const prompt = typeof content === "string" ? content : content.map(part => part.text ?? "").join("");
    let reply: object;
    if (system.includes("rule builder")) {
      calls.push("parse");
      reply = prompt.includes("Take the stronger draw")
        ? { understood: true, prefer: "LP", over: "4FL", unless: [{ type: "rank_held", on: "other", rank: "2" }], note: null }
        : { understood: true, prefer: "4FL", over: "LP", unless: [], note: null };
      if (gate) await gate();
    } else {
      calls.push("polish");
      const facts = JSON.parse(prompt.slice(prompt.indexOf("{"))) as { exceptions: string[] };
      reply = { ruleText: "Take the stronger draw, as the rule says.", exceptions: facts.exceptions.map(() => "In the exception, take the other hold."), mnemonic: "Strong draw, sure score" };
    }
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({
      id: `msg_${calls.length}`, type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1800, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }) });
  });
  return calls;
}

test("heuristics: cards from your mistakes, the Rule Lab's exact cost, AI polish and plain English", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const calls = await mockAnthropic(page);
  await createPlayTable(page, { mode: "drill" });
  // Draw five every hand: mostly mistakes, which Statistics ranks by cost.
  for (let hand = 0; hand < 10; hand++) {
    await page.getByRole("button", { name: "Deal hand", exact: true }).click();
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Deal hand", exact: true })).toBeEnabled();
  }

  await page.getByRole("link", { name: "Heuristics", exact: true }).click();
  await page.getByRole("button", { name: "Make cards from my mistakes" }).click();
  const cards = page.getByRole("article");
  await expect(cards.first()).toBeVisible({ timeout: 60_000 }); // the engine scores each card over every deal
  await expect(page.getByRole("status").filter({ hasText: /from your \d+ costliest mistake/ })).toBeVisible();
  const first = cards.first();
  await expect(first).toContainText("FROM YOUR MISTAKES");
  await expect(first).toContainText(/^.*Hold .+ over .+\./);
  await expect(first).toContainText("of return if you follow it");
  await expect(first).toContainText(/Decides \d+(\.\d)? of every 1,000 deals/);
  await expect(first.getByRole("link", { name: "Add an AI key to polish" })).toBeVisible();

  // The Rule Lab: pick two holds and see the engine's figures; an exception changes them.
  const lab = page.getByRole("region", { name: "Write a rule, see its exact cost" });
  await lab.getByLabel("Prefer").selectOption({ label: "Low pair (Tens or lower)" });
  await lab.getByLabel("Over").selectOption({ label: "4 to a Flush" });
  const result = lab.getByRole("group", { name: "Rule Lab result" });
  await expect(result).toContainText("Hold low pair (Tens or lower) over 4 to a Flush.");
  await expect(result).toContainText("of return if you follow it");
  await expect(result).toContainText("Where it's wrong");
  await lab.getByRole("button", { name: "Add exception" }).click();
  await lab.getByRole("group", { name: "Exception 1" }).getByLabel("Which hold").selectOption("other");
  await lab.getByRole("group", { name: "Exception 1" }).getByLabel("Condition").selectOption("rank_held");
  await lab.getByRole("group", { name: "Exception 1" }).getByLabel("Rank").selectOption("2");
  await expect(result).toContainText("When 4 to a Flush includes a 2, hold 4 to a Flush instead.");
  await expect(result).toContainText("without the exceptions");
  await result.getByRole("button", { name: "Save as card" }).click();
  await expect(cards.filter({ hasText: "FROM THE RULE LAB" })).toHaveCount(1);

  // With a key: polish a card's words (the rule and its costs stay the engine's), and fill the lab from plain English.
  await page.goto("/#/settings?section=ai");
  const provider = page.getByRole("group", { name: "Anthropic (Claude)" });
  await provider.getByRole("textbox", { name: "Anthropic (Claude) API key" }).fill("sk-ant-test-key");
  await provider.getByRole("button", { name: "Add key" }).click();
  await expect(provider.getByText("Key added")).toBeVisible();
  await page.getByRole("link", { name: "Heuristics", exact: true }).click();
  const labCard = cards.filter({ hasText: "FROM THE RULE LAB" });
  const cost = await labCard.locator(".heuristic-cost").textContent();
  await page.getByRole("radiogroup", { name: "Mnemonic style" }).getByRole("radio", { name: "Rhyme" }).click();
  await labCard.getByRole("button", { name: /^Polish with AI · about / }).click();
  await expect(labCard).toContainText("Take the stronger draw, as the rule says.");
  await expect(labCard).toContainText("“Strong draw, sure score”");
  await expect(labCard).toContainText("In the exception, take the other hold.");
  await expect(labCard.locator(".heuristic-cost")).toHaveText(cost!);
  await expect(labCard).toContainText("read back into a rule and checked against the engine's rule and numbers");
  // The engine's own words stay in view under the AI's.
  await expect(labCard.getByLabel("The engine's rule")).toContainText("Hold low pair (Tens or lower) over 4 to a Flush. When 4 to a Flush includes a 2, hold 4 to a Flush instead.");

  await lab.getByLabel("Rule in plain English").fill("A four-card flush draw beats a little pair");
  await lab.getByRole("button", { name: /^Fill in with AI · about / }).click();
  await expect(lab.getByLabel("Prefer")).toHaveValue("4FL");
  await expect(lab.getByLabel("Over")).toHaveValue("LP");
  await expect(result).toContainText("Hold 4 to a Flush over low pair (Tens or lower).");
  expect(calls).toEqual(["polish", "parse", "parse"]); // the polish is read back before it's saved
  expect(errors).toEqual([]);
});

test("Rule Lab: an AI reading that comes back after you changed the rule or the machine isn't filled in", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let release = () => {};
  const calls = await mockAnthropic(page, () => new Promise<void>(resolve => { release = resolve; }));
  await createPlayTable(page, { mode: "drill" });
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/state/app-store.ts" as string) as typeof import("../src/state/app-store");
    const { machineService } = await import("/src/services/machines.ts" as string) as typeof import("../src/services/machines");
    const [first] = Object.values(useAppStore.getState().machines);
    await machineService.save({ name: "Second table", paytableId: first.paytableId, defaultWalletId: first.defaultWalletId, denominationCents: 25 });
  });
  await page.goto("/#/settings?section=ai");
  const provider = page.getByRole("group", { name: "Anthropic (Claude)" });
  await provider.getByRole("textbox", { name: "Anthropic (Claude) API key" }).fill("sk-ant-test-key");
  await provider.getByRole("button", { name: "Add key" }).click();
  await expect(provider.getByText("Key added")).toBeVisible();
  await page.getByRole("link", { name: "Heuristics", exact: true }).click();
  const lab = page.getByRole("region", { name: "Write a rule, see its exact cost" });
  const fillIn = lab.getByRole("button", { name: /^Fill in with AI · about / });
  const stale = lab.getByRole("alert").filter({ hasText: "changed while the AI was reading" });

  await expect(lab.getByLabel("Prefer")).toBeVisible({ timeout: 60_000 }); // the table's holds are loaded

  // You edit the rule while the AI reads: its answer (4 to a Flush over a low pair) doesn't replace your edits.
  await lab.getByLabel("Rule in plain English").fill("A four-card flush draw beats a little pair");
  await fillIn.click();
  await expect.poll(() => calls.length).toBe(1);
  await lab.getByLabel("Prefer").selectOption("HP");
  await lab.getByLabel("Over").selectOption("LP");
  release();
  await expect(stale).toBeVisible();
  await expect(lab.getByLabel("Prefer")).toHaveValue("HP");
  await expect(lab.getByLabel("Over")).toHaveValue("LP");

  // You switch machines while the AI reads: the answer for the last table isn't filled in on this one.
  await fillIn.click();
  await expect.poll(() => calls.length).toBe(2);
  const machines = page.getByLabel("Heuristics machine");
  await machines.selectOption({ label: "Second table" });
  release();
  await expect(stale).toBeVisible();
  await expect(lab.getByLabel("Prefer")).toHaveValue("");
  await expect(lab.getByLabel("Over")).toHaveValue("");

  // Left alone, the reading fills in the builder.
  await expect(lab.getByLabel("Prefer")).toBeVisible({ timeout: 60_000 });
  await lab.getByLabel("Rule in plain English").fill("A four-card flush draw beats a little pair");
  await fillIn.click();
  await expect.poll(() => calls.length).toBe(3);
  release();
  await expect(lab.getByLabel("Prefer")).toHaveValue("4FL");
  await expect(lab.getByLabel("Over")).toHaveValue("LP");
  expect(errors).toEqual([]);
});

test("print: one PDF with the chart and your heuristic cards, then a wallet card", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await createPlayTable(page, { mode: "drill" });
  await page.getByRole("link", { name: "Heuristics", exact: true }).click();
  const lab = page.getByRole("region", { name: "Write a rule, see its exact cost" });
  await expect(lab.getByLabel("Prefer")).toBeVisible({ timeout: 60_000 }); // the table's holds are loaded
  await lab.getByLabel("Prefer").selectOption({ label: "Low pair (Tens or lower)" });
  await lab.getByLabel("Over").selectOption({ label: "4 to a Flush" });
  await lab.getByRole("group", { name: "Rule Lab result" }).getByRole("button", { name: "Save as card" }).click({ timeout: 60_000 });
  await expect(page.getByRole("article").filter({ hasText: "FROM THE RULE LAB" })).toHaveCount(1);

  const print = page.getByRole("region", { name: "Take your strategy with you" });
  await expect(print).toContainText("your 1 heuristic card on full pages, then a wallet card");
  await print.getByRole("radiogroup", { name: "Chart" }).getByRole("radio", { name: "Beginner" }).click();
  await print.getByLabel("Paper").selectOption("a4");
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await print.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^perfect-draw-.+-beginner\.pdf$/);
  await expect(print.getByRole("status").filter({ hasText: /^Saved perfect-draw-.+-beginner\.pdf: 1 page and a wallet card of \d panels\.$/ })).toBeVisible();
  const pdf = await PDFDocument.load(await readFile((await download.path())!));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getTitle()).toMatch(/· Beginner strategy$/);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
  expect(errors).toEqual([]);
});
