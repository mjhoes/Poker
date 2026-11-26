import { getCanonicalHands } from "./canonical";
import { getTrainingContext } from "./training";
import type { StrategyList } from "./strategies";

/**
 * Which line of a strategy chart picks the hold on each deal, for the Strategy Ladder: by canonical hand, the chart line
 * (index into `list.lines`) and whether the chart's hold is the best play there. The pick mirrors the chart scorer in
 * strategies.ts (highest line wins; ties go to the preferred hold), so each line's deals add up to its `freq`.
 */
export interface ChartLineIndex {
  /** Per canonical hand (getCanonicalHands() order): the line that picks the hold. */
  readonly line: Int16Array;
  /** Per canonical hand: 1 when the chart's hold is a best hold. */
  readonly optimal: Uint8Array;
  /** Per line: canonical hand IDs where the line picks a best hold (the hands a ladder can deal for it). */
  readonly dealable: readonly (readonly number[])[];
}

export function chartLineIndex(list: StrategyList): ChartLineIndex {
  if (!list.forMemorization || list.tier === "Perfect") throw new Error("The ladder uses the Beginner, Intermediate or Expert chart.");
  if (list.lines.some(line => line.exceptions.length)) throw new Error("The ladder needs a chart without exceptions.");
  const context = getTrainingContext(list.analysisKey), data = context.getData(), hands = getCanonicalHands();
  const level = list.refinement, names = data.names[level];
  const codes = new Map(names.map((name, code) => [name, code]));
  const priority = new Int32Array(names.length).fill(-1), groupOf = new Int32Array(names.length).fill(-1);
  let rank = 0;
  list.lines.forEach((line, group) => {
    for (const label of line.alternatives ?? [line.label]) {
      const code = codes.get(label);
      if (code === undefined) throw new Error(`Chart line "${label}" is not a category of this game.`);
      priority[code] = rank++; groupOf[code] = group;
    }
  });
  const generic = level === 2 ? names.map(name => codes.get(name.split("|")[0]) ?? -1) : [];
  const line = new Int16Array(hands.length).fill(-1), optimal = new Uint8Array(hands.length);
  const dealable: number[][] = list.lines.map(() => []);
  for (let h = 0; h < hands.length; h++) {
    let chosenRank = Infinity, chosenMask = -1, chosenCode = -1;
    for (let mask = 0; mask < 32; mask++) {
      const index = h * 32 + mask, code = data.labels[level][index];
      for (let alternative = 0; alternative < (level === 2 ? 2 : 1); alternative++) {
        const matching = alternative ? generic[code] : code;
        if (matching < 0) continue;
        const rank = priority[matching];
        if (rank < 0) continue;
        if (rank < chosenRank) { chosenRank = rank; chosenMask = mask; chosenCode = matching; }
        else if (rank === chosenRank && data.preferences[index] > data.preferences[h * 32 + chosenMask]) chosenMask = mask;
      }
    }
    if (chosenMask < 0) throw new Error("A strategy chart must end with drawing five.");
    const group = groupOf[chosenCode];
    line[h] = group;
    const best = context.analysis.perHand.get(hands[h].id)!.ev;
    if (Math.abs(best - data.evs[h * 32 + chosenMask]) < 1e-10) { optimal[h] = 1; dealable[group].push(hands[h].id); }
  }
  return { line, optimal, dealable };
}
