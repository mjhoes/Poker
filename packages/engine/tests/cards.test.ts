import { describe, expect, it } from "vitest";
import {
  cardRank, cardSuit, choose, formatCard, parseCard, parseHand, sortedHand,
  toCardMask, validateHand,
} from "../src";

describe("card representation", () => {
  it("round-trips all 52 cards in rank/suit order", () => {
    for (let card = 0; card < 52; card++) {
      expect(parseCard(formatCard(card))).toBe(card);
      expect(cardRank(card)).toBe(Math.floor(card / 4));
      expect(cardSuit(card)).toBe(card % 4);
    }
    expect(parseCard("2c")).toBe(0);
    expect(parseCard("As")).toBe(51);
    expect(parseCard("10H")).toBe(parseCard("Th"));
  });

  it("supports shorthand, spaces, commas, and an explicit sorted copy", () => {
    const hand = parseHand("AsKsQd7c2h");
    expect(parseHand("As Ks Qd 7c 2h")).toEqual(hand);
    expect(parseHand("As,Ks,Qd,7c,2h")).toEqual(hand);
    expect(sortedHand(hand)).toEqual([...hand].sort((a, b) => a - b));
    expect(formatCard(hand[0])).toBe("As");
  });

  it("represents the signed-word boundary and highest card without collisions", () => {
    expect(toCardMask([0, 31, 32, 51])).toEqual([0x80000001, 0x80001]);
    expect(toCardMask(Array.from({ length: 52 }, (_, i) => i))).toEqual([0xffffffff, 0xfffff]);
  });

  it.each(["", "As Ks", "AsAsQd7c2h", "AsKsQd7c2hJc", "AxKsQd7c2h", "As!KsQd7c2h"])("rejects malformed hand %j", text => {
    expect(() => parseHand(text)).toThrow();
  });

  it.each([-1, 52, 53, 0.5, NaN, Infinity])("rejects invalid card %j", card => {
    expect(() => validateHand([0, 1, 2, 3, card])).toThrow();
    expect(() => formatCard(card)).toThrow();
  });

  it("computes exact draw denominators", () => {
    expect([0, 1, 2, 3, 4, 5].map(k => choose(47, k))).toEqual([1, 47, 1081, 16215, 178365, 1533939]);
    expect(choose(52, 5)).toBe(2598960);
    expect(choose(1, 2)).toBe(0);
  });
});
