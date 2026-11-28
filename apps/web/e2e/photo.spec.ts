import { expect, test } from "@playwright/test";
import type { Browser, Page, Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/*
 * Photo capture against intercepted provider APIs. The "photos" are real images rendered here (a printed pay table, a
 * row of cards); the model's transcription is the scripted reply. The tests check what the app does with it.
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };

const jacks75 = [
  ["ROYAL FLUSH", [250, 500, 750, 1000, 4000]], ["STRAIGHT FLUSH", [50, 100, 150, 200, 250]], ["4 OF A KIND", [25, 50, 75, 100, 125]],
  ["FULL HOUSE", [7, 14, 21, 28, 35]], ["FLUSH", [5, 10, 15, 20, 25]], ["STRAIGHT", [4, 8, 12, 16, 20]],
  ["3 OF A KIND", [3, 6, 9, 12, 15]], ["2 PAIR", [2, 4, 6, 8, 10]], ["JACKS OR BETTER", [1, 2, 3, 4, 5]],
] as const;
const ddb96 = [
  ["ROYAL FLUSH", [250, 500, 750, 1000, 4000]], ["STRAIGHT FLUSH", [50, 100, 150, 200, 250]], ["4 ACES W/2,3,4", [400, 800, 1200, 1600, 2000]],
  ["4 2-4 W/A-4", [160, 320, 480, 640, 800]], ["4 ACES", [160, 320, 480, 640, 800]], ["4 2s, 3s, 4s", [80, 160, 240, 320, 400]],
  ["4 5s THRU Ks", [50, 100, 150, 200, 250]], ["FULL HOUSE", [9, 18, 27, 36, 45]], ["FLUSH", [6, 12, 18, 24, 30]], ["STRAIGHT", [4, 8, 12, 16, 20]],
  ["3 OF A KIND", [3, 6, 9, 12, 15]], ["2 PAIR", [1, 2, 3, 4, 5]], ["JACKS OR BETTER", [1, 2, 3, 4, 5]],
] as const;
const paytableReply = (rows: readonly (readonly [string, readonly number[]])[], extra: object = {}) => ({
  readable: true, gameGuess: null, multiplierGame: null, denominationCents: null, lines: null,
  rows: rows.map(([label, pays]) => ({ label, pays: [...pays], confidence: 0.96 })), ...extra,
});

/** A real image to "photograph": a printed pay table or a row of cards, rendered in a scratch page. */
async function renderPhoto(browser: Browser, body: string) {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  await page.setContent(`<body style="margin:0;background:#0b2a6b;color:#ffd84a;font:bold 26px sans-serif;padding:24px">${body}</body>`);
  const buffer = await page.screenshot({ type: "png" });
  await page.close();
  return { name: "photo.png", mimeType: "image/png", buffer };
}
const tableImage = (rows: readonly (readonly [string, readonly number[]])[]) =>
  `<table>${rows.map(([label, pays]) => `<tr><td style="padding-right:40px">${label}</td>${pays.map(pay => `<td style="padding:0 14px">${pay}</td>`).join("")}</tr>`).join("")}</table>`;

/** How many times the app signalled an outcome that leaves nothing on screen (see src/diagnostics.ts; clock-independent). */
const signals = (page: Page, name: string) => page.evaluate(mark => (window as unknown as { __perfectDrawSignals?: Record<string, number> }).__perfectDrawSignals?.[mark] ?? 0, name);

async function mockVision(page: Page, replies: { paytable?: object[]; hand?: object[]; hold?: Promise<void> }) {
  const calls: { kind: "paytable" | "hand"; model: string; hasImage: boolean }[] = [];
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (request.url().includes("/v1/models")) return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) });
    const body = request.postDataJSON() as { model: string; system: string; messages: { content: { type: string }[] }[] };
    const kind = body.system.includes("pay tables") ? "paytable" : "hand";
    calls.push({ kind, model: body.model, hasImage: Array.isArray(body.messages[0].content) && body.messages[0].content[0].type === "image" });
    const reply = replies[kind]?.shift();
    if (replies.hold) await replies.hold;
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({
      id: `msg_${calls.length}`, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(reply) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 2600, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }) });
  });
  return calls;
}

async function addKey(page: Page) {
  await page.goto("/#/settings?section=ai");
  const card = page.getByRole("group", { name: "Anthropic (Claude)" });
  await card.getByRole("textbox", { name: "Anthropic (Claude) API key" }).fill("sk-ant-test-key");
  await card.getByRole("button", { name: "Add key" }).click();
  await expect(card.getByText("Key added")).toBeVisible();
}

test("a pay table photo is read, checked, confirmed, saved and compared with the closest built-in table", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const rows = [...jacks75.filter(([label]) => label !== "STRAIGHT"), ["BONUS ROUND", [1, 2, 3, 4, 5]] as const];
  const reply = paytableReply(rows);
  reply.rows[3].confidence = 0.5; // full house, hard to read
  const calls = await mockVision(page, { paytable: [reply] });
  const photo = await renderPhoto(browser, tableImage(rows));
  await addKey(page);

  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pay table from a photo" });
  await dialog.getByLabel("Photo of the pay table").setInputFiles(photo);
  await expect(dialog.getByRole("img", { name: "Your photo of the pay table" })).toBeVisible();
  await expect(dialog.getByText(/^900 × 560 · location and other details removed$/)).toBeVisible();
  // Medium is the default for photos, with each size's estimated cost shown before reading.
  const sizes = dialog.getByRole("radiogroup", { name: "Model size" });
  await expect(sizes.getByRole("radio", { name: "Medium: Claude Sonnet 5.5" })).toHaveAttribute("aria-checked", "true");
  await expect(sizes).toContainText(/Claude Haiku 5\.5 · about (<)?\$0\.00\d/);
  await dialog.getByRole("button", { name: /^Read photo with Claude Sonnet 5\.5 · about \$0\.0\d\d$/ }).click();

  // The editor opens with the photo's pays, doubtful rows highlighted and the unnamed row to assign.
  await expect(dialog.getByRole("img", { name: "Your photo of the pay table" })).toBeVisible();
  await expect(dialog.getByText(/^Read by Claude Sonnet 5\.5 · \$0\.0\d\d\. Compare each highlighted row/)).toBeVisible();
  expect(calls).toEqual([{ kind: "paytable", model: "claude-sonnet-5-5", hasImage: true }]);
  await expect(dialog.getByRole("radio", { name: "Jacks or Better" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.locator("tr.is-doubtful", { hasText: "Full House" })).toContainText("Check");
  await expect(dialog.locator(".issue-list")).toContainText("Straight wasn't found in the photo. Enter its pays.");
  await dialog.getByRole("combobox", { name: "Hand for “BONUS ROUND”" }).selectOption({ label: "Straight" });
  await expect(dialog.locator(".issue-list")).not.toContainText("Straight wasn't found in the photo.");
  // Fix the straight to what the machine really pays (the unnamed row was a misread).
  await dialog.getByRole("textbox", { name: "Straight, 1 coin" }).fill("4");
  for (const [column, value] of [[2, "8"], [3, "12"], [4, "16"], [5, "20"]] as const) await dialog.getByRole("textbox", { name: `Straight, ${column} coins` }).fill(value);
  await expect(dialog.getByText("Closest built-in: 8/5 Jacks or Better, which differs in Full House.")).toBeVisible();
  await expect(dialog.locator(".return-value")).toHaveText(/^\d+\.\d\d%$/, { timeout: 45_000 });
  await dialog.getByRole("button", { name: "Save pay table" }).click();

  // After saving: return, place among Jacks or Better tables, and the strategy difference.
  const summary = dialog.getByRole("region", { name: "Your pay table" });
  await expect(summary.getByRole("heading", { name: "7/5 Jacks or Better" })).toBeVisible();
  await expect(summary).toContainText(/Return with perfect play\d+\.\d{3}%/);
  await expect(summary).toContainText(/Among Jacks or Better tables\d of 3 by return/);
  await expect(summary).toContainText(/The best hold changes on \d+(\.\d+)?% of deals compared with 8\/5 Jacks or Better\./, { timeout: 120_000 });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The same photo again: read from the device, no new call.
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  await page.getByLabel("Photo of the pay table").setInputFiles(photo);
  await page.getByRole("button", { name: /^Read photo with Claude Sonnet 5\.5/ }).click();
  await expect(page.getByText(/^Read by Claude Sonnet 5\.5 \(from this device, no new cost\)\./)).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a multiplier game is flagged, and a photo with no pay table says so", async ({ page, browser }) => {
  await mockVision(page, { paytable: [{ ...paytableReply([]), readable: false, rows: [] }, paytableReply(jacks75, { multiplierGame: "Ultimate X" })] });
  await addKey(page);
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  await page.getByLabel("Photo of the pay table").setInputFiles(await renderPhoto(browser, "Just a picture"));
  await page.getByRole("button", { name: /^Read photo with/ }).click();
  await expect(page.getByRole("alert")).toHaveText("No pay table was found in that photo. Try a straight-on shot of the whole pay table.");
  await page.getByLabel("Photo of the pay table").setInputFiles(await renderPhoto(browser, tableImage(jacks75)));
  await page.getByRole("button", { name: /^Read photo with/ }).click();
  await expect(page.getByText("Ultimate X isn't supported yet.")).toBeVisible();
});

test("a hand photo fills the Analyzer, with held cards, doubtful cards, and the pay table in the same photo", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const hand = {
    readable: true, payTableVisible: true, held: [true, true, true, true, false],
    cards: [["A", "spades"], ["A", "clubs"], ["8", "diamonds"], ["8", "hearts"], ["3", "clubs"]].map(([rank, suit], index) => ({ rank, suit, confidence: index === 4 ? 0.5 : 0.97 })),
  };
  const calls = await mockVision(page, { hand: [hand], paytable: [paytableReply(ddb96)] });
  await addKey(page);
  await page.goto("/#/analyze");
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Hand from a photo" });
  await dialog.getByLabel("Photo of the hand").setInputFiles(await renderPhoto(browser, `${tableImage(ddb96.slice(0, 4))}<p>A♠ A♣ 8♦ 8♥ 3♣</p>`));
  await dialog.getByRole("button", { name: /^Read photo with Claude Sonnet 5\.5/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Type a hand" })).toHaveValue("As Ac 8d 8h 3c");
  await expect(page.locator(".analyzer-slot.is-doubtful")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "Outlined cards were hard to read" })).toContainText("The HELD cards are shown as what you held.");
  await expect(page.getByRole("region", { name: "Holds ranked" }).locator(".hold-badge.is-mine")).toBeVisible();

  // The same photo shows the pay table: read it too, then analyze on that table.
  await page.getByRole("group", { name: "Pay table in the photo" }).getByRole("button", { name: "Read the pay table…" }).click();
  const tableDialog = page.getByRole("dialog", { name: "Pay table from the same photo" });
  await tableDialog.getByRole("button", { name: /^Read photo with/ }).click();
  await expect(tableDialog.getByText("Looks like the built-in 9/6 Double Double Bonus.")).toBeVisible();
  await tableDialog.getByRole("button", { name: "Use built-in table" }).click();
  await expect(tableDialog.getByText("This is one of the app's built-in tables")).toBeVisible();
  await tableDialog.getByRole("button", { name: "Analyze on this table" }).click();
  await expect(page.getByRole("combobox", { name: "Machine or pay table" }).locator("option:checked")).toHaveText("9/6 Double Double Bonus");
  await expect(page.getByRole("region", { name: "Holds ranked" }).getByRole("heading", { level: 2 })).toHaveText(/^A♠ A♣ · /);
  expect(calls.map(call => call.kind)).toEqual(["hand", "paytable"]);
});

test("a new machine can start from a pay table photo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Wallets", exact: true }).click();
  await page.getByRole("button", { name: "Set up a wallet", exact: true }).click();
  await page.getByRole("textbox", { name: "Wallet name", exact: true }).fill("Bankroll");
  await page.getByRole("textbox", { name: "Starting balance", exact: true }).fill("100");
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await page.getByRole("button", { name: "New machine" }).first().click();
  await page.getByRole("button", { name: /^Photograph a pay table/ }).click();
  await expect(page.getByRole("dialog", { name: "Pay table from a photo" }).getByRole("button", { name: "Take or choose a photo" })).toBeVisible();
  await expect(page.getByText("Reading photos uses your own Anthropic or OpenAI API key.")).toBeVisible();
});

const isLive = (page: Page, url: string) => page.evaluate(async src => { try { await (await fetch(src)).blob(); return true; } catch { return false; } }, url);

test("a reading that arrives after the dialog closed never replaces the hand", async ({ page, browser }) => {
  let release!: () => void;
  const hand = { readable: true, payTableVisible: false, held: null, cards: [["A", "spades"], ["A", "clubs"], ["8", "diamonds"], ["8", "hearts"], ["3", "clubs"]].map(([rank, suit]) => ({ rank, suit, confidence: 0.97 })) };
  const calls = await mockVision(page, { hand: [hand], hold: new Promise<void>(resolve => { release = resolve; }) });
  await addKey(page);
  await page.goto("/#/analyze");
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Hand from a photo" });
  await dialog.getByLabel("Photo of the hand").setInputFiles(await renderPhoto(browser, "A♠ A♣ 8♦ 8♥ 3♣"));
  await dialog.getByRole("button", { name: /^Read photo with/ }).click();
  await expect.poll(() => calls.length).toBe(1);
  await dialog.getByRole("button", { name: "Close dialog" }).click(); // give up on the photo
  await page.getByRole("textbox", { name: "Type a hand" }).fill("2c 3d 4h 5s 9c");
  release();
  await expect.poll(() => signals(page, "photo:read-dropped")).toBe(1); // the late reading arrived and was dropped
  await expect(page.getByRole("textbox", { name: "Type a hand" })).toHaveValue("2c 3d 4h 5s 9c");
  await expect(page.locator(".analyzer-slot.is-doubtful")).toHaveCount(0);
  await expect(page.locator(".analyzer-photo-note")).toHaveCount(0);
});

test("photos are released from memory when replaced, declined or closed", async ({ page, browser }) => {
  await mockVision(page, { paytable: [{ readable: false, rows: [], gameGuess: null, multiplierGame: null, denominationCents: null, lines: null }] });
  await addKey(page);
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pay table from a photo" });
  const preview = dialog.getByRole("img", { name: "Your photo of the pay table" });
  await dialog.getByLabel("Photo of the pay table").setInputFiles(await renderPhoto(browser, "first"));
  const first = (await preview.getAttribute("src"))!;
  await dialog.getByLabel("Photo of the pay table").setInputFiles(await renderPhoto(browser, "second"));
  await expect(preview).not.toHaveAttribute("src", first);
  const second = (await preview.getAttribute("src"))!;
  expect(await isLive(page, first)).toBe(false); // replaced
  // A reading the flow declines (no pay table) leaves the photo with the reader, still shown.
  await dialog.getByRole("button", { name: /^Read photo with/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("No pay table was found");
  expect(await isLive(page, second)).toBe(true);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await isLive(page, second)).toBe(false); // closed
});

/** Lets a test hold each photo's preparation and see which preview URLs were created and released. */
async function controlPreparation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __hold: boolean; __gates: (() => void)[]; __created: string[]; __revoked: string[] };
    w.__hold = false; w.__gates = []; w.__created = []; w.__revoked = [];
    const original = window.createImageBitmap.bind(window) as (...args: unknown[]) => Promise<ImageBitmap>;
    (window as unknown as { createImageBitmap: unknown }).createImageBitmap = (...args: unknown[]) => new Promise((resolve, reject) => {
      const go = () => { original(...args).then(resolve, reject); };
      if (w.__hold) w.__gates.push(go); else go();
    });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => { const url = create(object); w.__created.push(url); return url; };
    URL.revokeObjectURL = (url: string) => { w.__revoked.push(url); revoke(url); };
  });
  return {
    hold: (on: boolean) => page.evaluate(value => { (window as unknown as { __hold: boolean }).__hold = value; }, on),
    pending: () => page.evaluate(() => (window as unknown as { __gates: unknown[] }).__gates.length),
    finish: (index: number) => page.evaluate(i => { (window as unknown as { __gates: (() => void)[] }).__gates[i](); }, index),
    /** Preview URLs created and not released, other than the ones still in use. */
    leaked: (inUse: string[]) => page.evaluate(keep => {
      const w = window as unknown as { __created: string[]; __revoked: string[] };
      return w.__created.filter(url => url.startsWith("blob:") && !keep.includes(url) && !w.__revoked.includes(url));
    }, inUse),
  };
}
const paste = (page: Page, photo: { buffer: Buffer; mimeType: string }) => page.evaluate(({ data, type }) => {
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], "pasted.png", { type }));
  window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer }));
}, { data: photo.buffer.toString("base64"), type: photo.mimeType });

test("a read of photo A that finishes while photo B is still being prepared is dropped", async ({ page, browser }) => {
  let release!: () => void;
  const hand = { readable: true, payTableVisible: false, held: null, cards: [["A", "spades"], ["A", "clubs"], ["8", "diamonds"], ["8", "hearts"], ["3", "clubs"]].map(([rank, suit]) => ({ rank, suit, confidence: 0.97 })) };
  const calls = await mockVision(page, { hand: [hand], hold: new Promise<void>(resolve => { release = resolve; }) });
  const prep = await controlPreparation(page);
  await addKey(page);
  await page.goto("/#/analyze");
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Hand from a photo" });
  await dialog.getByLabel("Photo of the hand").setInputFiles(await renderPhoto(browser, "photo A"));
  await dialog.getByRole("button", { name: /^Read photo with/ }).click();
  await expect.poll(() => calls.length).toBe(1);             // A's read is in flight
  await prep.hold(true);
  await dialog.getByLabel("Photo of the hand").setInputFiles(await renderPhoto(browser, "photo B"));
  await expect.poll(prep.pending).toBe(1);                   // B is still being prepared
  release();                                                  // A's reply arrives now
  await expect.poll(() => signals(page, "photo:read-dropped")).toBe(1); // ...and is dropped
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Type a hand" })).toHaveValue("");
  await expect(dialog.getByRole("button", { name: /^Read photo with/ })).toBeDisabled(); // nothing to read until B is ready
  await prep.finish(0);
  await expect(dialog.getByRole("button", { name: /^Read photo with/ })).toBeEnabled();
});

test("photos chosen in quick succession show the newest, whichever finishes preparing first", async ({ page, browser }) => {
  const prep = await controlPreparation(page);
  await addKey(page);
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pay table from a photo" });
  const preview = dialog.getByRole("img", { name: "Your photo of the pay table" });
  await prep.hold(true);
  await dialog.getByLabel("Photo of the pay table").setInputFiles(await renderPhoto(browser, "photo A"));
  await paste(page, await renderPhoto(browser, "photo B"));   // B pasted while A is preparing
  await expect.poll(prep.pending).toBe(2);
  await prep.finish(1);                                       // B finishes first
  await expect(preview).toBeVisible();
  const newest = (await preview.getAttribute("src"))!;
  await prep.finish(0);                                       // then A
  await expect.poll(() => signals(page, "photo:prepare-dropped")).toBe(1); // A, superseded, is discarded
  await expect(preview).toHaveAttribute("src", newest);       // still B
  expect(await prep.leaked([newest])).toEqual([]);            // A's preview was released, not kept
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  expect(await prep.leaked([])).toEqual([]);                  // and B's on closing
});

test("an iPhone HEIC photo is converted here and read, whatever type the browser gives it", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  // Chromium can't decode HEIC itself (Safari can): the app converts it, then sends a JPEG like any other photo.
  const sent: string[] = [];
  page.on("request", request => {
    if (request.url().includes("api.anthropic.com/v1/messages") && request.method() === "POST") {
      const body = request.postDataJSON() as { messages: { content: { type: string; source?: { media_type: string } }[] }[] };
      sent.push(body.messages[0].content[0].source?.media_type ?? "none");
    }
  });
  await mockVision(page, { paytable: [paytableReply(jacks75)] });
  await addKey(page);
  const heic = await readFile(fileURLToPath(new URL("./fixtures/paytable-photo.heic", import.meta.url)));
  for (const mimeType of ["", "image/heic"]) { // Windows gives HEIC no type; macOS says image/heic
    await page.getByRole("button", { name: "From a photo", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pay table from a photo" });
    await dialog.getByLabel("Photo of the pay table").setInputFiles({ name: "IMG_0412.HEIC", mimeType, buffer: heic });
    await expect(dialog.getByRole("img", { name: "Your photo of the pay table" })).toBeVisible({ timeout: 60_000 });
    await expect(dialog.locator(".photo-meta")).toHaveText("900 × 600 · location and other details removed");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pay table from a photo" });
  await dialog.getByLabel("Photo of the pay table").setInputFiles({ name: "IMG_0412.HEIC", mimeType: "image/heic", buffer: heic });
  await dialog.getByRole("button", { name: /^Read photo with Claude Sonnet 5\.5/ }).click();
  await expect.poll(() => sent).toEqual(["image/jpeg"]);
  // A file named .HEIC that isn't one, and a file that isn't a photo at all, still say so.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "From a photo", exact: true }).click();
  const input = page.getByLabel("Photo of the pay table"), alert = page.getByRole("dialog", { name: "Pay table from a photo" }).getByRole("alert");
  await input.setInputFiles({ name: "IMG_0413.HEIC", mimeType: "image/heic", buffer: Buffer.from("not really a photo") });
  await expect(alert).toHaveText("This browser couldn't open that image. Try a JPEG, PNG or HEIC photo.");
  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") });
  await expect(alert).toHaveText("That file isn't an image. Choose a photo (JPEG, PNG, HEIC or WebP).");
  expect(errors).toEqual([]);
});
