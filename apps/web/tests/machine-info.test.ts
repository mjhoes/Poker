import { describe, expect, it } from "vitest";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { machineDraftSchema } from "@perfect-draw/shared";
import { STARTER_MACHINES, defaultMachineName, denominationLabel, starterDraft } from "../src/machines/machine-info";

const jacks = PAY_TABLE_LIBRARY.find(table => table.slug === "jacks-or-better-9-6")!;

describe("machine names and labels", () => {
  it("labels denominations the way machines do", () => {
    expect(denominationLabel(1)).toBe("1¢");
    expect(denominationLabel(25)).toBe("25¢");
    expect(denominationLabel(100)).toBe("$1");
    expect(denominationLabel(250)).toBe("$2.50");
  });
  it("builds a descriptive default name", () => {
    expect(defaultMachineName(jacks.id, 25, 1)).toBe("9/6 Jacks or Better · 25¢");
    expect(defaultMachineName(jacks.id, 100, 3)).toBe("9/6 Jacks or Better · $1 · 3-play");
  });
  it("starter machines are valid drafts for library tables", () => {
    for (const starter of STARTER_MACHINES) {
      const draft = starterDraft(starter.slug, "0190f2a6-7c3e-7b10-8000-000000000001");
      expect(draft).not.toBeNull();
      expect(machineDraftSchema.safeParse(draft).success).toBe(true);
    }
  });
});
