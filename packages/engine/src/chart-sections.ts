import { describeLabel } from "./label-descriptions";
import type { StrategyLine, StrategyList } from "./strategies";
import type { GameFamilyId } from "./types";

export interface StrategySection {
  readonly deucesHeld: number;
  readonly title: string;
  readonly startRank: number;
  readonly endRank: number;
}
export const deuceSection = (label: string): number => 4 - Number(label.match(/^D([0-4])_/)?.[1] ?? 4);

export function chartSections(family: GameFamilyId, lines: readonly StrategyLine[]): StrategySection[] | undefined {
  if (family !== "deuces_wild") return undefined;
  let offset = 0;
  return [4, 3, 2, 1, 0].map(deucesHeld => {
    const startRank = offset;
    offset += lines.filter(line => line.label.startsWith(`D${deucesHeld}_`)).length;
    return { deucesHeld, title: `${deucesHeld} deuce${deucesHeld === 1 ? "" : "s"} held`, startRank, endRank: offset };
  });
}

export function formatStrategyChart(list: StrategyList): string {
  if (!list.forMemorization) throw new Error(`${list.tier} is not a memorization chart.`);
  const print = (line: StrategyLine) => `${line.rank + 1}. ${describeLabel(line.label, list.familyId)}`;
  const lines = list.sections
    ? list.sections.flatMap(section => [section.title, ...list.lines.slice(section.startRank, section.endRank).map(print)])
    : list.lines.map(print);
  return [list.tier,
    "Draw categories are exclusive: royal draws are separate from other straight-flush/flush draws; straight-flush draws are separate from flush/straight draws.",
    list.tieBreakRule, ...lines].join("\n");
}
