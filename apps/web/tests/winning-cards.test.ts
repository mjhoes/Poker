import { describe, expect, it } from "vitest";
import { evaluateHand, parseHand } from "@perfect-draw/engine";
import { winningMask } from "../src/table/cards";

const check = (text: string, familyId: "jacks_or_better" | "double_double_bonus" | "deuces_wild") => {
  const hand = parseHand(text);
  return { rank: evaluateHand(hand, familyId), mask: winningMask(hand, evaluateHand(hand, familyId), familyId) };
};

describe("winning-card highlights follow the engine's hand rank", () => {
  it("marks only the paying pair, pairs, trips or quads", () => {
    expect(check("Jh Js 4c 7d 9s", "jacks_or_better")).toEqual({ rank: "JACKS_OR_BETTER", mask: 0b00011 });
    expect(check("4h Ks 4c Kd 9s", "jacks_or_better")).toEqual({ rank: "TWO_PAIR", mask: 0b01111 });
    expect(check("8h 8s 2c 8d As", "jacks_or_better")).toEqual({ rank: "THREE_KIND", mask: 0b01011 });
    expect(check("9h 9s 9c 9d As", "jacks_or_better")).toEqual({ rank: "FOUR_KIND", mask: 0b01111 });
  });
  it("marks all five cards for straights, flushes, full houses and kicker quads", () => {
    expect(check("5h 6s 7c 8d 9s", "jacks_or_better").mask).toBe(0b11111);
    expect(check("2h 7h 9h Jh Kh", "jacks_or_better").mask).toBe(0b11111);
    expect(check("Qh Qs Qc 3d 3s", "jacks_or_better").mask).toBe(0b11111);
    expect(check("Ah As Ac Ad 3s", "double_double_bonus")).toEqual({ rank: "FOUR_ACES_W_234", mask: 0b11111 });
  });
  it("counts wild deuces toward the made hand", () => {
    expect(check("2h 9s 9c 5d Ks", "deuces_wild")).toEqual({ rank: "THREE_KIND", mask: 0b00111 });
    expect(check("2h 2s 2c 2d Ks", "deuces_wild")).toEqual({ rank: "FOUR_DEUCES", mask: 0b01111 });
  });
  it("marks nothing for a losing hand", () => {
    expect(check("2h 7s 9c Jd Ks", "jacks_or_better")).toEqual({ rank: "NOTHING", mask: 0 });
  });
});
