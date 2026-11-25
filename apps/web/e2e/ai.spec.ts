import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

/*
 * AI features against intercepted provider APIs: no real keys and no real calls. The handlers check what the SDKs send
 * (the player's key and Anthropic's direct-browser header) and reply in each API's format.
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
const goodText = {
  summary: "Keep the two pair: it is the stronger hold here.",
  why: "Drawing one card to two pair can still make a Full House, which the compared hold gives up.",
  howToRemember: "Two pair stays two pair: never break it to keep a single pair.",
  commonMistake: null,
};

interface Calls { anthropic: { model: string; headers: Record<string, string> }[]; openai: { model: string; headers: Record<string, string> }[] }

async function mockProviders(page: Page, replies: { anthropic?: object[]; openai?: object[] } = {}) {
  const calls: Calls = { anthropic: [], openai: [] };
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const headers = request.headers();
    // SDK 1.x (API version 2026-10-21) sends the key as a bearer token; older ones used x-api-key.
    if (headers.authorization !== "Bearer sk-ant-test-key" && headers["x-api-key"] !== "sk-ant-test-key") return route.fulfill({ status: 401, headers: CORS, contentType: "application/json", body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
    if (request.url().includes("/v1/models")) return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) });
    const body = request.postDataJSON() as { model: string };
    calls.anthropic.push({ model: body.model, headers });
    const reply = replies.anthropic?.shift() ?? goodText;
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({
      id: `msg_${calls.anthropic.length}`, type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 2400, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }) });
  });
  await page.route("https://api.openai.com/**", async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const headers = request.headers();
    if (headers.authorization !== "Bearer sk-openai-test-key") return route.fulfill({ status: 401, headers: CORS, contentType: "application/json", body: JSON.stringify({ error: { message: "Incorrect API key", type: "invalid_request_error", code: "invalid_api_key" } }) });
    if (request.url().includes("/v1/models")) return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ object: "list", data: [] }) });
    const body = request.postDataJSON() as { model: string };
    calls.openai.push({ model: body.model, headers });
    const reply = replies.openai?.shift() ?? goodText;
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({
      id: `resp_${calls.openai.length}`, object: "response", created_at: 1764000000, status: "completed", model: body.model,
      output: [{ type: "message", id: "msg_1", status: "completed", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(reply), annotations: [] }] }],
      usage: { input_tokens: 2400, output_tokens: 800, total_tokens: 3200, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 300 } },
    }) });
  });
  return calls;
}

async function addKey(page: Page, provider: "Anthropic (Claude)" | "OpenAI (GPT)", key: string) {
  const card = page.getByRole("group", { name: provider });
  await card.getByRole("textbox", { name: `${provider} API key` }).fill(key);
  await card.getByRole("button", { name: "Add key" }).click();
  await expect(card.getByText("Key added")).toBeVisible();
}

test("explain a hold with either provider, see the cost first and after, and reopen it for free", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const calls = await mockProviders(page);
  await page.goto("/#/analyze?hand=AsAc8d8h3c");
  const why = page.getByRole("region", { name: "Why the best hold is better" });

  // No key yet: an invitation, and nothing is sent.
  await expect(why.getByRole("link", { name: "Add an API key" })).toBeVisible();
  await why.getByRole("link", { name: "Add an API key" }).click();
  await expect(page.getByRole("heading", { name: "AI explanations" })).toBeVisible();

  // Add a key and test it (free).
  await addKey(page, "Anthropic (Claude)", "sk-ant-test-key");
  const anthropic = page.getByRole("group", { name: "Anthropic (Claude)" });
  await anthropic.getByRole("button", { name: "Test connection" }).click();
  await expect(anthropic.getByRole("status")).toHaveText("Connected. The key works.");
  expect(calls.anthropic).toHaveLength(0); // the model list is not a billed call

  // Back in the analyzer: each model size shows an estimated cost before anything is sent.
  await page.goto("/#/analyze?hand=AsAc8d8h3c");
  const explain = why.getByRole("group", { name: "Explain in plain English" });
  const sizes = explain.getByRole("radiogroup", { name: "Model size" });
  await expect(sizes.getByRole("radio", { name: "Heavy: Claude Opus 5.5" })).toHaveAttribute("aria-checked", "true");
  await expect(sizes).toContainText(/Claude Haiku 5\.5 · about (<)?\$0\.00\d/);
  await expect(sizes).toContainText(/Claude Opus 5\.5 · about \$0\.0\d\d/);
  await sizes.getByRole("radio", { name: "Light: Claude Haiku 5.5" }).click();
  await explain.getByRole("button", { name: /^Explain with Claude Haiku 5\.5 · about/ }).click();
  await expect(explain.locator(".explain-summary")).toHaveText(goodText.summary);
  await expect(explain).toContainText("How to remember: Two pair stays two pair");
  // The real cost, from the provider's token counts: 2,400 × $0.10 + 800 × $0.50 per million = $0.00064.
  await expect(explain.locator(".explain-meta")).toContainText("Claude Haiku 5.5 · cost <$0.001 (2,400 tokens in, 800 out)");
  expect(calls.anthropic.map(call => call.model)).toEqual(["claude-haiku-5-5"]);
  expect(calls.anthropic[0].headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  expect(calls.anthropic[0].headers.authorization).toBe("Bearer sk-ant-test-key");

  // Reopening the same comparison shows the saved explanation without a new call, even with the key forgotten
  // (keys are kept in memory only, by default).
  await page.reload();
  await expect(explain.locator(".explain-summary")).toHaveText(goodText.summary);
  await expect(explain.locator(".explain-meta")).toContainText("saved on this device, no new cost");
  expect(calls.anthropic).toHaveLength(1);

  await expect(explain.getByRole("link", { name: "Add an API key" })).toBeVisible();

  // OpenAI too: add both keys, switch provider, heavy model.
  await page.goto("/#/settings?section=ai");
  await addKey(page, "Anthropic (Claude)", "sk-ant-test-key");
  await addKey(page, "OpenAI (GPT)", "sk-openai-test-key");
  await page.goto("/#/analyze?hand=AsAc8d8h3c");
  await explain.getByRole("radiogroup", { name: "AI provider" }).getByRole("radio", { name: "OpenAI" }).click();
  await sizes.getByRole("radio", { name: "Heavy: GPT-6.2 Astra" }).click();
  await explain.getByRole("button", { name: /^Explain with GPT-6\.2 Astra/ }).click();
  await expect(explain.locator(".explain-meta")).toContainText("GPT-6.2 Astra · cost $0.051 (2,400 tokens in, 800 out)");
  expect(calls.openai.map(call => call.model)).toEqual(["gpt-6.2-astra"]);

  // The usage log adds it up: $0.00064 + $0.0512.
  await page.goto("/#/settings?section=ai");
  const usage = page.getByRole("group", { name: "AI usage this month" });
  await expect(usage).toContainText("2 calls · about $0.052");
  await expect(usage.getByRole("row", { name: /Claude Haiku 5\.5/ })).toContainText("2,400 / 800");
  await expect(usage.getByRole("row", { name: /GPT-6\.2 Astra/ })).toContainText("$0.051");
  expect(errors).toEqual([]);
});

test("a reply that invents numbers is retried once and then not shown; keys are forgotten unless remembered", async ({ page }) => {
  const invented = { ...goodText, why: "A Full House comes 1 in 999 draws." };
  const calls = await mockProviders(page, { anthropic: [invented, invented] });
  await page.goto("/#/settings?section=ai");
  await addKey(page, "Anthropic (Claude)", "sk-ant-test-key");
  await page.goto("/#/analyze?hand=AsAc8d8h3c");
  const explain = page.getByRole("group", { name: "Explain in plain English" });
  await explain.getByRole("button", { name: /^Explain with Claude Opus 5\.5/ }).click();
  await expect(explain.getByRole("alert")).toHaveText("The explanation didn't match the engine's numbers, so it isn't shown. Try again or try another model.");
  await expect(explain.locator(".explain-summary")).toHaveCount(0);
  expect(calls.anthropic).toHaveLength(2);

  // Not remembered: a reload forgets the key (and nothing was saved for this comparison).
  await page.reload();
  await expect(page.getByRole("link", { name: "Add an API key" })).toBeVisible();
  await expect(explain.locator(".explain-summary")).toHaveCount(0);

  // Remembered: it survives a reload, with the warning shown.
  await page.goto("/#/settings?section=ai");
  await addKey(page, "Anthropic (Claude)", "sk-ant-test-key");
  await page.getByRole("checkbox", { name: /Remember keys on this device/ }).click();
  await expect(page.getByRole("checkbox", { name: /Remember keys on this device/ })).toBeChecked();
  await expect(page.getByText("Stored unencrypted in this browser.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Anthropic (Claude)" }).getByText("Key added")).toBeVisible();
  await page.getByRole("group", { name: "Anthropic (Claude)" }).getByRole("button", { name: "Forget key" }).click();
  await page.reload();
  await expect(page.getByRole("group", { name: "Anthropic (Claude)" }).getByText("No key")).toBeVisible();
});

test("after a mistake at the table, the drawer offers the explanation", async ({ page }) => {
  await mockProviders(page);
  await page.goto("/#/settings?section=ai");
  await addKey(page, "Anthropic (Claude)", "sk-ant-test-key");
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await page.getByRole("button", { name: /^Start with/ }).click();
  await page.getByRole("button", { name: "Add 9/6 Jacks or Better" }).click();
  await page.getByRole("button", { name: /^(Play|Continue)$/ }).first().click();
  await page.getByRole("button", { name: "Table settings", exact: true }).click();
  await page.getByRole("button", { name: "Show after draw", exact: true }).click();
  await page.keyboard.press("Escape");
  for (let hand = 0; hand < 8; hand++) {
    await page.getByRole("button", { name: "Deal hand", exact: true }).click();
    await page.getByRole("button", { name: "Draw", exact: true }).click(); // drawing five is almost always a mistake
    if (await page.getByText("Why is the best hold better?").count()) break;
  }
  await page.getByText("Why is the best hold better?").click();
  const explain = page.getByRole("group", { name: "Explain in plain English" });
  await expect(explain.getByRole("button", { name: /^Explain with Claude Opus 5\.5 · about \$0\.0\d\d$/ })).toBeVisible();
});
