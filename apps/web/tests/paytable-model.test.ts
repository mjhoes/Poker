import { describe, expect, it } from "vitest";
import { PAY_TABLE_LIBRARY, getLibraryPayTable } from "@perfect-draw/paytables";
import { draftFromLibrary, finalize, isLinear, libraryMatch, matchRank, parsePasted, quickFill, setPerCoin, validate } from "../src/paytables/model";
import type { DraftTable } from "../src/paytables/model";

const name = (rank: string) => rank;
const filled = (result: ReturnType<typeof quickFill>): DraftTable => {
  if ("error" in result) throw new Error(result.error);
  return result.draft;
};

describe("starting points and identity", () => {
  it("starts from the family's library table and recognises it", () => {
    const draft = draftFromLibrary("jacks_or_better");
    expect(libraryMatch(draft)?.slug).toBe("jacks-or-better-9-6");
    expect(isLinear(draft)).toBe(true);
    expect(finalize(draft).id).toBe(getLibraryPayTable("jacks-or-better-9-6").id);
  });
  it("finalize always includes a zero row for losing hands", () => {
    expect(finalize(draftFromLibrary("deuces_wild")).pays.NOTHING).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("shorthand", () => {
  it("9/6 → 8/5 turns 9/6 Jacks into 8/5 Jacks", () => {
    const draft = filled(quickFill(draftFromLibrary("jacks_or_better"), "8/5"));
    expect(draft.pays.FULL_HOUSE).toEqual([8, 16, 24, 32, 40]);
    expect(draft.pays.FLUSH).toEqual([5, 10, 15, 20, 25]);
    expect(libraryMatch(draft)?.slug).toBe("jacks-or-better-8-5");
  });
  it("accepts a third number for the straight and other separators", () => {
    const draft = filled(quickFill(draftFromLibrary("double_bonus"), "9 - 6 - 4"));
    expect(draft.pays.STRAIGHT?.[0]).toBe(4);
  });
  it("fills every row from a complete list, treating a large royal as the max-bet per-coin pay", () => {
    const draft = filled(quickFill(draftFromLibrary("jacks_or_better"), "800/50/25/9/6/4/3/2/1"));
    expect(draft.pays.ROYAL_FLUSH).toEqual([250, 500, 750, 1000, 4000]);
    expect(libraryMatch(draft)?.slug).toBe("jacks-or-better-9-6");
  });
  it("rejects too many numbers", () => {
    expect(quickFill(draftFromLibrary("jacks_or_better"), "9/6/4/3/2")).toHaveProperty("error");
  });
});

describe("pasted pay tables", () => {
  it("matches hand names in common spellings", () => {
    expect(matchRank("Four Aces w/ 2-4", "double_double_bonus")).toBe("FOUR_ACES_W_234");
    expect(matchRank("4 2s, 3s, 4s w/ A-4", "double_double_bonus")).toBe("FOUR_234_W_A234");
    expect(matchRank("Four 5s thru Ks", "double_double_bonus")).toBe("FOUR_5K");
    expect(matchRank("Straight Flush", "jacks_or_better")).toBe("STRAIGHT_FLUSH");
    expect(matchRank("Wild Royal", "deuces_wild")).toBe("WILD_ROYAL");
    expect(matchRank("Royal Flush", "deuces_wild")).toBe("NATURAL_ROYAL");
    expect(matchRank("Kangaroo", "jacks_or_better")).toBeNull();
  });
  it("reads one pay per line, or five columns, and reports what it could not read", () => {
    const text = [
      "Royal Flush\t250\t500\t750\t1,000\t4,000",
      "Four of a Kind 25",
      "Full House 8",
      "Flush 5",
      "Mystery bonus 99",
    ].join("\n");
    const result = parsePasted(draftFromLibrary("jacks_or_better"), text);
    expect(result.changed).toEqual(["ROYAL_FLUSH", "FOUR_KIND", "FULL_HOUSE", "FLUSH"]);
    expect(result.unmatched).toEqual(["Mystery bonus 99"]);
    expect(libraryMatch(result.draft)?.slug).toBe("jacks-or-better-8-5");
  });
  it("fills rows in order when lines have no names", () => {
    const result = parsePasted(draftFromLibrary("jacks_or_better"), "800\n50\n25\n8\n5");
    expect(result.changed).toEqual(["ROYAL_FLUSH", "STRAIGHT_FLUSH", "FOUR_KIND", "FULL_HOUSE", "FLUSH"]);
    expect(libraryMatch(result.draft)?.slug).toBe("jacks-or-better-8-5");
  });
});

describe("checks", () => {
  it("passes the library tables cleanly", () => {
    for (const table of PAY_TABLE_LIBRARY) {
      expect([table.slug, validate(draftFromLibrary(table.familyId, table.slug), name)]).toEqual([table.slug, []]);
    }
  });
  it("warns when a weaker hand pays more, or a hand pays nothing", () => {
    let draft = setPerCoin(draftFromLibrary("jacks_or_better"), "FLUSH", 12);
    expect(validate(draft, name)).toContainEqual(expect.objectContaining({ rank: "FLUSH", level: "warning" }));
    draft = setPerCoin(draftFromLibrary("jacks_or_better"), "TWO_PAIR", 0);
    expect(validate(draft, name)).toContainEqual(expect.objectContaining({ rank: "TWO_PAIR", level: "warning" }));
  });
  it("blocks fractional pays", () => {
    const draft = setPerCoin(draftFromLibrary("jacks_or_better"), "FLUSH", 5.5);
    expect(validate(draft, name)).toContainEqual(expect.objectContaining({ rank: "FLUSH", level: "error" }));
  });
});
