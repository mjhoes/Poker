import { describe, expect, it } from "vitest";
import { parseCents } from "../src/services/money";
describe("exact-cent form inputs", () => {
  it("converts cents exactly, including large safe integers", () => {
    expect(parseCents("1.01")).toBe(101);
    expect(parseCents("0.29")).toBe(29);
    expect(parseCents(" 20.2 ")).toBe(2020);
    expect(parseCents("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseCents("0", true)).toBe(0);
  });
  it("rejects unsafe, fractional-cent, exponent and negative amounts", () => {
    for (const value of ["", "-1", "1.001", "1e2", "Infinity", "NaN", "90071992547409.92", "0"]) {
      expect(parseCents(value)).toBeNull();
    }
  });
});
