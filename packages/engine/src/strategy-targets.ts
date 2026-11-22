import type { StrategyList } from "./strategies";

/** Penalty-specific lines count as exceptions as well as printed chart lines. */
export function strategyExceptionCount(list: Pick<StrategyList, "lines">): number {
  return list.lines.reduce((sum, line) => sum + line.exceptions.length + (line.label.includes("|pen:") ? 1 : 0), 0);
}

export function strategyMeetsTarget(list: Pick<StrategyList, "tier" | "lines" | "costVsOptimal" | "optimalDecisionFreq">): boolean {
  switch (list.tier) {
    case "Beginner": return list.lines.length <= 15 && list.costVsOptimal <= 0.15 + 1e-10;
    case "Expert": return list.lines.length <= 60 && strategyExceptionCount(list) <= 15 && list.costVsOptimal <= 0.03 + 1e-10;
    case "Reference": return list.costVsOptimal <= 0.02 + 1e-10 && list.optimalDecisionFreq >= 0.999;
    case "Perfect": return list.lines.length === 0 && list.costVsOptimal === 0;
    case "Intermediate": return true; // No specified accuracy/length target.
  }
}
