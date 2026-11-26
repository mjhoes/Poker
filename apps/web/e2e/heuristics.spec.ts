import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { createPlayTable } from "./play-helpers";

/*
 * Heuristics: cards from your mistakes, the Rule Lab, and AI polish and plain English against an intercepted Anthropic
 * API (no real key, no real call). The fake model reads the request: it rewords a card keeping one sentence per
 * exception, and turns any plain-English rule into "4 to a flush over a low pair".
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
async function mockAnthropic(page: Page) {
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
      reply = { understood: true, prefer: "4FL", over: "LP", unless: [], note: null };
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
  await expect(cards.first()).toBeVisible();
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
  await expect(labCard).toContainText("checked against the engine's numbers");

  await lab.getByLabel("Rule in plain English").fill("A four-card flush draw beats a little pair");
  await lab.getByRole("button", { name: /^Fill in with AI · about / }).click();
  await expect(lab.getByLabel("Prefer")).toHaveValue("4FL");
  await expect(lab.getByLabel("Over")).toHaveValue("LP");
  await expect(result).toContainText("Hold 4 to a Flush over low pair (Tens or lower).");
  expect(calls).toEqual(["polish", "parse"]);
  expect(errors).toEqual([]);
});
