import { describe, expect, it } from "vitest";
import { dollarsFor, formatCoins } from "../src/components/ui/CoinAmount";

describe("credit amounts always carry a dollar value", () => {
  it("converts credits at the machine denomination", () => {
    expect(dollarsFor(45, 25)).toBe("$11.25");
    expect(dollarsFor(1985, 25)).toBe("$496.25");
    expect(formatCoins(15, 100)).toBe("15 credits ($15.00)");
  });
  it("keeps EV precision and rounds dollars to the cent", () => {
    expect(formatCoins(2.47, 25, { digits: 3 })).toBe("2.470 credits ($0.62)");
    expect(formatCoins(0, 25, { digits: 3 })).toBe("0.000 credits ($0.00)");
  });
  it("shows sub-cent losses as <$0.01 instead of a misleading $0.00", () => {
    expect(dollarsFor(0.004, 25)).toBe("<$0.01");
    expect(dollarsFor(-0.004, 25)).toBe("−<$0.01");
    expect(formatCoins(0.0004, 1, { digits: 3 })).toBe("4.0e-4 credits (<$0.01)");
  });
});
