import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseHand } from "@perfect-draw/engine";
import { getLibraryPayTable, PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { handRankName } from "../src/components/UiHelpers";
import { db, initializeDatabase } from "../src/data/db";
import { matchAnyRank, payingRanks, libraryMatch } from "../src/paytables/model";
import { closestLibraryTable, returnRank } from "../src/photo/closest-table";
import { cardFromReply, handProblem, readHand } from "../src/photo/hand-photo";
import type { HandReply } from "../src/photo/hand-photo";
import { fitWithin, imageTokens } from "../src/photo/image";
import { photoChecks, readPaytable } from "../src/photo/paytable-photo";
import type { PaytableReply } from "../src/photo/paytable-photo";
import { photoService } from "../src/photo/photo-service";
import { setProviderFactory } from "../src/ai/router";
import { aiService, usageService, useAiStore } from "../src/ai/store";
import type { LLMProvider, TextRequest } from "../src/ai/types";

/** A reply as a model would transcribe a built-in table: printed names, all five columns. */
function replyFor(slug: string, label = (rank: string) => handRankName(rank).toUpperCase()): PaytableReply {
  const table = getLibraryPayTable(slug);
  return {
    readable: true, gameGuess: null, multiplierGame: null, denominationCents: null, lines: null,
    rows: payingRanks(table.familyId).map(rank => ({ label: label(rank), pays: [...(table.pays as Record<string, readonly number[]>)[rank]], confidence: 0.97 })),
  };
}

describe("reading a pay table photo", () => {
  it.each(PAY_TABLE_LIBRARY.map(table => table.slug))("recognizes %s from its printed rows", slug => {
    const reading = readPaytable(replyFor(slug));
    const table = getLibraryPayTable(slug);
    expect(reading.familyId).toBe(table.familyId);
    expect(reading.unknown).toEqual([]);
    expect(reading.missing).toEqual([]);
    expect(reading.doubtful).toEqual([]);
    expect(libraryMatch(reading.draft)?.id).toBe(table.id);
  });

  it("understands the abbreviations printed on real machines", () => {
    const printed: Record<string, string> = {
      ROYAL_FLUSH: "ROYAL FLUSH", STRAIGHT_FLUSH: "STR FLUSH", FOUR_ACES_W_234: "4 ACES W/2,3,4", FOUR_234_W_A234: "4 2-4 W/A-4",
      FOUR_ACES: "4 ACES", FOUR_234: "4 2s, 3s, 4s", FOUR_5K: "4 5s THRU Ks", FULL_HOUSE: "FULL HOUSE", FLUSH: "FLUSH",
      STRAIGHT: "STRAIGHT", THREE_KIND: "3 OF A KIND", TWO_PAIR: "2 PAIR", JACKS_OR_BETTER: "JACKS OR BETTER",
    };
    const reading = readPaytable(replyFor("double-double-bonus-9-6", rank => printed[rank]));
    expect(reading.familyId).toBe("double_double_bonus");
    expect(reading.unknown).toEqual([]);
    expect(libraryMatch(reading.draft)?.slug).toBe("double-double-bonus-9-6");
  });

  it.each([
    ["FOUR ACES WITH ANY 2,3,4", "FOUR_ACES_W_234"], ["4 ACES W/ANY 2-4", "FOUR_ACES_W_234"], ["FOUR ACES + 2, 3 OR 4", "FOUR_ACES_W_234"],
    ["FOUR 2,3,4 WITH ANY A,2,3,4", "FOUR_234_W_A234"], ["4 2s-4s W/ANY A-4", "FOUR_234_W_A234"],
    ["FOUR ACES", "FOUR_ACES"], ["4 2s, 3s, 4s", "FOUR_234"], ["FOUR DEUCES", "FOUR_DEUCES"],
  ])("maps the kicker wording %s to the right hand", (label, rank) => {
    expect(matchAnyRank(label)).toBe(rank);
  });
  it("fills columns the photo doesn't show, and marks those hands to double-check", () => {
    const reply = replyFor("jacks-or-better-9-6");
    reply.rows = reply.rows.map(row => ({ ...row, pays: row.label.startsWith("ROYAL") ? [null, null, null, null, 4000] : [row.pays[0], null, null, null, null] }));
    const reading = readPaytable(reply);
    expect(libraryMatch(reading.draft)?.slug).toBe("jacks-or-better-9-6");
    expect(reading.doubtful.length).toBe(payingRanks("jacks_or_better").length);
  });

  it("leaves unknown labels and missing hands to the player, and flags low confidence", () => {
    const reply = replyFor("jacks-or-better-9-6");
    reply.rows = reply.rows.filter(row => row.label !== "FLUSH");
    reply.rows.push({ label: "BONUS SPIN", pays: [1, 2, 3, 4, 5], confidence: 0.9 });
    reply.rows[1].confidence = 0.4;
    const reading = readPaytable(reply);
    expect(reading.unknown).toEqual([{ label: "BONUS SPIN", pays: [1, 2, 3, 4, 5] }]);
    expect(reading.missing).toEqual(["FLUSH"]);
    expect(reading.issues.map(issue => issue.message)).toContain("Flush wasn't found in the photo. Enter its pays.");
    expect(reading.doubtful).toContain("STRAIGHT_FLUSH");
  });

  it("tells Bonus from Double Bonus, and Jacks from Bonus Deluxe, by their pays", () => {
    expect(readPaytable(replyFor("bonus-poker-8-5")).familyId).toBe("bonus_poker");
    expect(readPaytable(replyFor("double-bonus-10-7")).familyId).toBe("double_bonus");
    expect(readPaytable(replyFor("bonus-poker-deluxe-9-6")).familyId).toBe("bonus_poker_deluxe");
    expect(readPaytable(replyFor("deuces-wild-full-pay")).familyId).toBe("deuces_wild");
  });

  it("passes multiplier games and screen details through, and checks columns and the royal", () => {
    const reply = { ...replyFor("jacks-or-better-9-6"), multiplierGame: "Ultimate X", denominationCents: 25, lines: 3 };
    const reading = readPaytable(reply);
    expect(reading).toMatchObject({ multiplierGame: "Ultimate X", denominationCents: 25, lines: 3 });
    const odd = { ...reading.draft, pays: { ...reading.draft.pays, FLUSH: [6, 12, 18, 24, 35] as [number, number, number, number, number], ROYAL_FLUSH: [250, 500, 750, 1000, 400] as [number, number, number, number, number] } };
    const messages = photoChecks(odd).map(issue => issue.message);
    expect(messages).toContain("Flush's columns aren't 1×–5× the 1-coin pay. Check the photo.");
    expect(messages).toContain("Royal Flush pays 400 at 5 coins; it is usually 4,000. Check the photo.");
  });

  it("names the closest built-in table and the rows that differ", () => {
    const draft = readPaytable(replyFor("jacks-or-better-9-6")).draft;
    draft.pays.FULL_HOUSE = [7, 14, 21, 28, 35];
    const closest = closestLibraryTable(draft)!;
    expect(closest.table.slug).toBe("jacks-or-better-9-6");
    expect(closest.differing).toEqual(["FULL_HOUSE"]);
    expect(returnRank(99, [99.54, 98.45, 97.3])).toEqual({ place: 2, of: 4 });
  });
});

describe("reading a hand photo", () => {
  const reply = (cards: [string, string][], extra: Partial<HandReply> = {}): HandReply =>
    ({ readable: true, cards: cards.map(([rank, suit]) => ({ rank, suit, confidence: 0.95 })), held: null, payTableVisible: false, ...extra });

  it("turns the reported cards into the hand, with held cards and doubtful ones", () => {
    const read = readHand({ ...reply([["A", "spades"], ["Ace", "Clubs"], ["8", "diamonds"], ["8", "heart"], ["3", "♣"]]), held: [true, true, true, true, false], payTableVisible: true });
    expect(read.cards).toEqual([...parseHand("As Ac 8d 8h 3c")]);
    expect(read.heldMask).toBe(0b01111);
    expect(read.payTableVisible).toBe(true);
    expect(cardFromReply("10", "hearts")).toBe(parseHand("Th 2c 3c 4c 5c")[0]);
    const doubtful = reply([["A", "spades"], ["K", "spades"], ["Q", "spades"], ["J", "spades"], ["10", "spades"]]);
    doubtful.cards[4].confidence = 0.5;
    expect(readHand(doubtful).doubtful).toEqual([4]);
  });
  it("asks again for a reply that isn't five different real cards", () => {
    expect(handProblem(reply([["A", "spades"], ["A", "spades"], ["8", "d"], ["8", "h"], ["3", "c"]]))).toContain("same");
    expect(handProblem(reply([["A", "spades"], ["K", "spades"]]))).toContain("exactly five");
    expect(handProblem(reply([["1", "spades"], ["K", "spades"], ["Q", "s"], ["J", "s"], ["10", "s"]]))).toContain("rank");
    expect(() => readHand({ ...reply([]), readable: false })).toThrow("Couldn't read five cards");
  });
});

describe("images and cost", () => {
  it("fits photos within 1,600 px without enlarging them", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it("estimates image tokens by each provider's rule", () => {
    expect(imageTokens("anthropic", 1600, 1200)).toBe(Math.ceil((1238 * 928) / 750));
    expect(imageTokens("openai", 1600, 1200)).toBe(85 + 170 * 2 * 2);
  });
  it("estimates a photo's cost by model size", () => {
    const image = { width: 1600, height: 1200 };
    const light = photoService.estimate("paytable", image, "anthropic", "light"), medium = photoService.estimate("paytable", image, "anthropic", "medium");
    expect(light).toBeLessThan(0.003);
    expect(medium).toBeGreaterThan(0.01);
    expect(medium).toBeLessThan(0.05);
  });
});

describe("the photo service", () => {
  beforeEach(async () => {
    await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
    await initializeDatabase();
    useAiStore.setState({ keys: {}, settings: null });
    await aiService.load();
    await aiService.setKey("anthropic", "sk-ant");
  });
  afterEach(() => setProviderFactory(null));
  const image = { base64: "AAAA", mediaType: "image/jpeg" as const, width: 1600, height: 1200, fingerprint: "f".repeat(64), previewUrl: "" };

  it("defaults photos to the medium model", async () => {
    expect(useAiStore.getState().settings?.visionTier).toBe("medium");
  });
  it("sends the photo, caches the reading by fingerprint and model, and never stores the photo", async () => {
    const requests: TextRequest<unknown>[] = [];
    setProviderFactory(async (provider): Promise<LLMProvider> => ({
      id: provider,
      async text<T>(request: TextRequest<T>) { requests.push(request as TextRequest<unknown>); return { data: replyFor("jacks-or-better-9-6") as T, model: request.model, inputTokens: 3000, outputTokens: 900 }; },
      async test() { return { ok: true as const }; },
    }));
    const first = await photoService.read("paytable", image, "anthropic", "medium");
    expect(first).toMatchObject({ cached: false, calls: 1, model: "claude-sonnet-5-5" });
    expect(requests[0].image).toEqual({ base64: "AAAA", mediaType: "image/jpeg" });
    const again = await photoService.read("paytable", image, "anthropic", "medium");
    expect(again).toMatchObject({ cached: true, cost: 0 });
    expect(requests).toHaveLength(1);
    await photoService.read("paytable", image, "anthropic", "light"); // another model reads afresh
    expect(requests).toHaveLength(2);
    const stored = await db.records("uploads").toArray();
    expect(stored.every(row => row.imageBlob === undefined)).toBe(true);
    expect((await usageService.summary()).calls).toBe(2);
  });
  it("retries a hand reply that isn't five different cards", async () => {
    const replies: HandReply[] = [
      { readable: true, cards: [{ rank: "A", suit: "spades", confidence: 1 }, { rank: "A", suit: "spades", confidence: 1 }, { rank: "8", suit: "diamonds", confidence: 1 }, { rank: "8", suit: "hearts", confidence: 1 }, { rank: "3", suit: "clubs", confidence: 1 }], held: null, payTableVisible: false },
      { readable: true, cards: [{ rank: "A", suit: "spades", confidence: 1 }, { rank: "A", suit: "clubs", confidence: 1 }, { rank: "8", suit: "diamonds", confidence: 1 }, { rank: "8", suit: "hearts", confidence: 1 }, { rank: "3", suit: "clubs", confidence: 1 }], held: null, payTableVisible: false },
    ];
    setProviderFactory(async (provider): Promise<LLMProvider> => ({
      id: provider,
      async text<T>(request: TextRequest<T>) { return { data: replies.shift() as T, model: request.model, inputTokens: 2000, outputTokens: 300 }; },
      async test() { return { ok: true as const }; },
    }));
    const result = await photoService.read("hand", { ...image, fingerprint: "e".repeat(64) }, "anthropic", "medium");
    expect(result.calls).toBe(2);
    expect(readHand(result.reply).cards).toEqual([...parseHand("As Ac 8d 8h 3c")]);
  });
});
