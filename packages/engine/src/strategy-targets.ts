import type { StrategyList } from "./strategies";
import type { GameFamilyId } from "./types";

export function strategyTarget(tier: StrategyList["tier"], family: GameFamilyId): { maxLines: number; gap: number } {
  if (tier === "Expert") return { maxLines: family === "deuces_wild" ? 75 : 60, gap: 0.03 };
  if (tier === "Beginner") return {
    maxLines: family === "deuces_wild" ? 20 : 15,
    gap: family === "double_bonus" || family === "double_double_bonus" || family === "deuces_wild" ? 0.35 : 0.15,
  };
  return { maxLines: Infinity, gap: tier === "Reference" ? 0.02 : Infinity };
}

/** Penalty-specific lines count as exceptions as well as printed chart lines. */
export function strategyExceptionCount(list: Pick<StrategyList, "lines">): number {
  return list.lines.reduce((sum, line) => sum + line.exceptions.length + (line.label.includes("|pen:") ? 1 : 0), 0);
}

export function strategyMeetsTarget(list: Pick<StrategyList, "tier" | "familyId" | "lines" | "costVsOptimal" | "optimalDecisionFreq">): boolean {
  switch (list.tier) {
    case "Beginner": return list.lines.length <= strategyTarget(list.tier, list.familyId).maxLines &&
      list.costVsOptimal <= strategyTarget(list.tier, list.familyId).gap + 1e-10;
    case "Expert": return list.lines.length <= strategyTarget(list.tier, list.familyId).maxLines &&
      strategyExceptionCount(list) <= 15 && list.costVsOptimal <= 0.03 + 1e-10;
    case "Reference": return list.costVsOptimal <= 0.02 + 1e-10 && list.optimalDecisionFreq >= 0.999;
    case "Perfect": return list.lines.length === 0 && list.costVsOptimal === 0;
    case "Intermediate": return true; // No specified accuracy/length target.
  }
}
