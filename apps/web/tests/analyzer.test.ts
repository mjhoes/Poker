import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeHandFast, parseCard, parseHand, standardVariant } from "@perfect-draw/engine";
const cardsOf = (text: string) => text.split(" ").map(parseCard);
import { getLibraryPayTable } from "@perfect-draw/paytables";
import { decodeAnalyzerQuery, encodeAnalyzerQuery, handText, randomHand, readHandText } from "../src/analyzer/hand-input";
import { compareAcross, rankHolds } from "../src/analyzer/ranked-holds";
import { buildTargets, resolveTarget } from "../src/analyzer/targets";
import { parseHash } from "../src/hooks/useRoute";
import { db, initializeDatabase } from "../src/data/db";
import { preferencesService } from "../src/services/preferences";

const jacks = getLibraryPayTable("jacks-or-better-9-6");
const ddb = getLibraryPayTable("double-double-bonus-9-6");

describe("typing a hand", () => {
  it.each([
    "As Ks Qd 7c 2h", "AsKsQd7c2h", "as ks qd 7c 2h", "A♠ K♠ Q♦ 7♣ 2♥", "As, Ks, Qd, 7c, 2h",
  ])("reads %s", text => {
    expect(readHandText(text)).toEqual({ cards: parseHand("As Ks Qd 7c 2h"), complete: true, error: null });
  });
  it("reads ten as T or 10", () => {
    expect(readHandText("Th 10d").cards).toEqual(cardsOf("Th Td"));
  });
  it("accepts partial input while typing, including a rank waiting for its suit", () => {
    expect(readHandText("As K")).toEqual({ cards: cardsOf("As"), complete: false, error: null });
    expect(readHandText("1")).toEqual({ cards: [], complete: false, error: null });
    expect(readHandText("")).toEqual({ cards: [], complete: false, error: null });
  });
  it("says what is wrong", () => {
    expect(readHandText("As Zx").error).toBe("“Zx” is not a card. Use a rank (2–10, J, Q, K, A) then a suit (c, d, h, s).");
    expect(readHandText("7c As 7c").error).toBe("Two cards are the 7 of clubs.");
    expect(readHandText("As Ks Qs Js Ts 9s").error).toBe("That's 6 cards; a hand has five.");
  });
  it("writes a hand back as text and makes five distinct random cards", () => {
    expect(handText(cardsOf("As 10d 2h"))).toBe("As Td 2h");
    let seed = 1;
    const cards = randomHand(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    expect(new Set(cards).size).toBe(5);
    expect(cards.every(card => card >= 0 && card < 52)).toBe(true);
  });
});

describe("the analyzer's address", () => {
  it("round-trips hand, table, bet and held cards", () => {
    const hand = parseHand("As Ks Qd 7c 2h");
    const search = encodeAnalyzerQuery({ hand, paytableId: jacks.id, coins: 3, held: 0b00011 });
    expect(search).toBe(`hand=AsKsQd7c2h&table=${jacks.id}&bet=3&held=3`);
    expect(decodeAnalyzerQuery(search)).toEqual({ hand, paytableId: jacks.id, coins: 3, held: 3, tableRequested: true });
  });
  it("ignores anything invalid rather than guessing", () => {
    expect(decodeAnalyzerQuery("hand=AsAs&table=nope&bet=9&held=40")).toEqual({ hand: null, paytableId: null, coins: null, held: null, tableRequested: true });
    expect(decodeAnalyzerQuery("hand=AsKsQd7c2h").tableRequested).toBe(false);
  });
  it("routes #/analyze with its search, and unknown pages home", () => {
    expect(parseHash("#/analyze?hand=AsKsQd7c2h&bet=5")).toEqual({ route: "/analyze", search: "hand=AsKsQd7c2h&bet=5" });
    expect(parseHash("#/stats")).toEqual({ route: "/stats", search: "" });
    expect(parseHash("#/nowhere?x=1")).toEqual({ route: "/", search: "" });
    expect(parseHash("")).toEqual({ route: "/", search: "" });
  });
});

describe("choosing the table", () => {
  const tables = [jacks, ddb].map(table => ({ id: table.id, name: table.name, familyId: table.familyId, pays: table.pays, source: "library" as const }));
  const targets = buildTargets([], tables);
  it("uses the table a link names when it is available", () => {
    expect(resolveTarget(targets, { requested: true, paytableId: ddb.id, coins: 5 })).toMatchObject({ target: { paytableId: ddb.id }, missing: false });
  });
  it("says when a named table is missing or malformed instead of silently showing another", () => {
    const unknown = resolveTarget(targets, { requested: true, paytableId: "f".repeat(64), coins: 5 });
    expect(unknown.missing).toBe(true);
    expect(unknown.target?.paytableId).toBe(jacks.id); // the fallback is shown, with a notice
    expect(resolveTarget(targets, { requested: true, paytableId: null }).missing).toBe(true);
    expect(resolveTarget(targets, {}).missing).toBe(false);
  });
});

describe("ranking holds", () => {
  it("lists all 32 holds best first, marking ties and close calls", () => {
    const analysis = analyzeHandFast(parseHand("As Ks Qs Js 9s"), standardVariant.valueVector(jacks, 5, {}), jacks.familyId);
    const ranked = rankHolds(analysis.results, 5);
    expect(ranked.rows).toHaveLength(32);
    expect(ranked.rows[0]).toMatchObject({ rank: 1, best: true, behind: 0, mask: analysis.best.mask });
    expect(ranked.rows.every((row, index) => index === 0 || row.ev <= ranked.rows[index - 1].ev)).toBe(true);
    expect(ranked.bestCount).toBe(1);
    // Holding all five (a flush, 30) vs drawing to the royal: not a close call.
    expect(ranked.closeCall).toBeNull();
  });
  it("counts equal holds as best and flags a near-equal runner-up", () => {
    const equal = rankHolds([{ mask: 1, label: "A", ev: 2 }, { mask: 2, label: "B", ev: 2 }, { mask: 3, label: "C", ev: 1.97 }], 5);
    expect(equal.bestCount).toBe(2);
    expect(equal.rows.map(row => row.best)).toEqual([true, true, false]);
    expect(equal.closeCall).toEqual({ gap: expect.closeTo(0.03, 10), mask: 3 });
    // The threshold scales with the bet: 0.03 is not close at one coin (0.01).
    expect(rankHolds([{ mask: 1, label: "A", ev: 2 }, { mask: 3, label: "C", ev: 1.97 }], 1).closeCall).toBeNull();
  });
});

describe("across pay tables", () => {
  it("marks tables where the best hold differs and what the selected hold would cost there", () => {
    // Two pair with aces: Jacks keeps the two pair; Double Double Bonus throws the other pair to chase four aces.
    const cards = parseHand("As Ac 8d 8h 3c");
    const one = (table: typeof jacks) => {
      const hand = analyzeHandFast(cards, standardVariant.valueVector(table, 5, {}), table.familyId);
      const evByMask = Array.from({ length: 32 }, () => 0);
      for (const hold of hand.results) evByMask[hold.mask] = hold.ev;
      return { paytableId: table.id, coins: 5, name: table.name, machine: false, familyId: table.familyId, bestMask: hand.best.mask, bestLabel: hand.best.label, bestEv: hand.best.ev, evByMask };
    };
    const job = one(jacks), double = one(ddb);
    expect(job.bestMask).toBe(0b01111);
    expect(double.bestMask).toBe(0b00011);
    const rows = compareAcross(job.bestMask, [job, double]);
    expect(rows[0]).toMatchObject({ differs: false, cost: 0 });
    expect(rows[1].differs).toBe(true);
    expect(rows[1].cost).toBeCloseTo(double.bestEv - double.evByMask[0b01111], 12);
  });
});

describe("recent hands", () => {
  beforeEach(async () => {
    await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
    await initializeDatabase();
  });
  const recent = async () => (await db.records("profile").get("local"))!.prefs.recentHands;
  it("keeps the newest first, lists the same hand once, and keeps 20", async () => {
    await preferencesService.addRecentHand({ hand: [...parseHand("As Ks Qd 7c 2h")], paytableId: jacks.id, coins: 5 });
    await preferencesService.addRecentHand({ hand: [...parseHand("2h 3h 4h 5h 6h")], paytableId: jacks.id, coins: 5 });
    // The same cards in another order, same table and bet: moved to the top, not added again.
    await preferencesService.addRecentHand({ hand: [...parseHand("2h As Ks Qd 7c")], paytableId: jacks.id, coins: 5 });
    expect((await recent()).map(row => handText(row.hand))).toEqual(["2h As Ks Qd 7c", "2h 3h 4h 5h 6h"]);
    // A different bet is a different entry.
    await preferencesService.addRecentHand({ hand: [...parseHand("As Ks Qd 7c 2h")], paytableId: jacks.id, coins: 1 });
    expect(await recent()).toHaveLength(3);
    for (let index = 0; index < 25; index++) await preferencesService.addRecentHand({ hand: [index, index + 1, index + 2, index + 3, index + 4] as never, paytableId: ddb.id, coins: 5 });
    expect(await recent()).toHaveLength(20);
    await preferencesService.clearRecentHands();
    expect(await recent()).toEqual([]);
  });
});
