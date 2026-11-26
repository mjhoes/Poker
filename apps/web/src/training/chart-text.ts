import { gradeLabel } from "../table/Feedback";
import type { LadderChart } from "../worker/engine-api";

/*
 * A strategy chart line in words. A line can group several holds; they're in order, not interchangeable: the engine
 * plays the first one the hand has (each has its own priority) and compares holds by the tie-break rule only when the
 * hand has several of that same one. So they're joined with "else", never "or".
 */
export const ALTERNATIVES_JOIN = ", else ";
export const chartLineText = (line: Pick<LadderChart["lines"][number], "label" | "alternatives">, familyId: string) =>
  (line.alternatives ?? [line.label]).map(label => gradeLabel(label, familyId)).join(ALTERNATIVES_JOIN);
/** How to read a line with "else", for any chart that has one. */
export const ALTERNATIVES_NOTE = "Where a line lists holds joined by “else”, they're in order: hold the first one your hand has.";
