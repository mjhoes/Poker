import type { HoldComparison } from "../table/hold-breakdown";
import { oneIn } from "../table/hold-breakdown";
import { maskIndexes, shortCard } from "../table/cards";

/*
 * Grounded explanations: the model receives only the engine's numbers (these facts) and must not add any. Pure and unit
 * tested; `checkNumbers` is the client-side guard that every number in the reply appears here.
 */

export const EXPLAIN_PROMPT_VERSION = 1;

export interface ExplainInput {
  hand: readonly number[]; gameName: string; payTableName: string; coins: number;
  best: { mask: number; name: string };
  other: { mask: number; name: string; role: "Your hold" | "The runner-up" | "This hold" };
  comparison: HoldComparison;
  /** The engine's own one-sentence summary (`comparisonSummary`). */ summary: string;
}

const value = (n: number) => n.toFixed(2);
const holdCards = (hand: readonly number[], mask: number) => maskIndexes(mask).map(index => shortCard(hand[index])).join(" ") || "nothing (draw five new cards)";

/** The data the model is given, as plain JSON-ready values (all figures already formatted the way the app shows them). */
export function explainFacts(input: ExplainInput) {
  const { comparison: c } = input;
  return {
    game: input.gameName,
    payTable: input.payTableName,
    betCoinsPerLine: input.coins,
    hand: input.hand.map(shortCard),
    bestHold: { keep: holdCards(input.hand, input.best.mask), name: input.best.name, expectedValue: c.a.ev.toFixed(3), possibleDraws: c.a.drawCount, winsOn: `${(c.a.winProbability * 100).toFixed(1)}% of draws` },
    comparedHold: { who: input.other.role, keep: holdCards(input.hand, input.other.mask), name: input.other.name, expectedValue: c.b.ev.toFixed(3), possibleDraws: c.b.drawCount, winsOn: `${(c.b.winProbability * 100).toFixed(1)}% of draws` },
    bestHoldIsWorthMoreBy: c.delta.toFixed(3),
    finalHands: c.rows.map(row => ({
      hand: row.name, paysAtThisBet: row.a.pay,
      bestHold: { chance: oneIn(row.a.count, c.a.drawCount), value: value(row.a.ev) },
      comparedHold: { chance: oneIn(row.b.count, c.b.drawCount), value: value(row.b.ev) },
      difference: `${row.delta >= 0 ? "+" : "-"}${value(Math.abs(row.delta))}`,
      deciding: c.decisive.includes(row.rank),
    })),
    engineSummary: input.summary,
    units: `Pays, expected value and value are in credits per line at this bet (${input.coins} coin${input.coins === 1 ? "" : "s"} per line); value = chance × pay.`,
  };
}
export type ExplainFacts = ReturnType<typeof explainFacts>;

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Every number written in the facts (card ranks, pays, chances, values, counts inside names such as "4 to a Flush"). */
export function factNumbers(facts: unknown): number[] {
  const found = new Set<number>();
  const visit = (node: unknown) => {
    if (typeof node === "number") found.add(node);
    else if (typeof node === "string") for (const match of node.match(NUMBER) ?? []) found.add(Number(match.replace(/,/g, "")));
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") Object.values(node).forEach(visit);
  };
  visit(facts);
  return [...found];
}

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };
const NUMBER_WORD = `(?:${[...UNITS, ...TENS.filter(Boolean), ...Object.keys(SCALES)].join("|")})`;
const NUMBER_WORDS = new RegExp(`\\b${NUMBER_WORD}(?:(?:[\\s-]+|[\\s-]+and[\\s-]+)${NUMBER_WORD})*\\b`, "gi");
/** Claims of proportion the model would have to calculate: "twice", "half", "three times as likely". */
const RATIOS = /\b(?:twice|thrice|triple|half|halves|quarter|(?:\d+|[a-z]+)\s+times\s+(?:as|more|less|the))\b/gi;

function wordsValue(phrase: string) {
  let total = 0, current = 0;
  for (const word of phrase.toLowerCase().split(/[\s-]+/).filter(item => item && item !== "and")) {
    if (UNITS.includes(word)) current += UNITS.indexOf(word);
    else if (TENS.includes(word)) current += TENS.indexOf(word) * 10;
    else if (word === "hundred") current = (current || 1) * 100;
    else { total += (current || 1) * SCALES[word]; current = 0; }
  }
  return total + current;
}

/**
 * The numbers in `text` that the facts don't contain. Accepted: the same number however it is formatted ("1,081",
 * "100.0" vs "100"), or a fact shown with fewer decimals ("3.8" for 3.83, never a whole number rounded from a decimal).
 * Numbers written as words count too ("ninety-nine percent"), except small counts of cards ("keep two cards", zero to
 * five) that are not percentages. Ratio words ("twice", "three times as likely") are always rejected: the facts state
 * no ratios, so any such claim was calculated by the model.
 */
export function checkNumbers(text: string, allowed: readonly number[]): string[] {
  const bad: string[] = [];
  const isFact = (n: number, decimals = 0) => allowed.some(fact => Math.abs(fact - n) < 1e-9 || (decimals > 0 && Math.abs(Number(fact.toFixed(decimals)) - n) < 1e-9));
  const flag = (raw: string) => { if (!bad.includes(raw)) bad.push(raw); };
  for (const raw of text.match(NUMBER) ?? []) {
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    if (!isFact(Number(raw.replace(/,/g, "")), decimals)) flag(raw);
  }
  for (const match of text.matchAll(NUMBER_WORDS)) {
    const value = wordsValue(match[0]);
    const percent = /^\s*(?:percent|per cent|%)/i.test(text.slice((match.index ?? 0) + match[0].length));
    if (!isFact(value) && (percent || value > 5)) flag(match[0]);
  }
  for (const match of text.matchAll(RATIOS)) flag(match[0]);
  return bad;
}

export const EXPLAIN_SYSTEM = [
  "You are a friendly video poker coach. You explain why one hold is better than another, for a player learning",
  "perfect strategy, in plain English.",
  "",
  "Use only the numbers in the DATA you are given, written the same way. Never calculate, estimate or round to a new",
  "number, and never mention money or dollars. You may describe numbers in words (\"about one draw in twelve\") only by",
  "quoting the DATA's own figure alongside. Refer to holds by the cards kept or by their names.",
  "",
  "Write:",
  "- summary: one sentence saying which hold is better and the main reason.",
  "- why: two or three sentences on which final hands make the difference and why (small chance of a big pay, or",
  "  larger chance of a small pay). Name the deciding hands.",
  "- howToRemember: one short, memorable rule of thumb a player can recall at the machine. Prefer no numbers here.",
  "- commonMistake: one sentence on the tempting mistake this hand invites, or null if there isn't a typical one.",
].join("\n");

export function explainPrompt(facts: ExplainFacts) {
  return `DATA (computed by the strategy engine):\n${JSON.stringify(facts, null, 2)}\n\nExplain why the best hold beats the compared hold.`;
}

export const explainRetryNote = (problem: string) =>
  `Your previous reply had a problem. ${problem}. Rewrite it using only figures that appear in the DATA, exactly as written there.`;

/** Identifies one comparison, so its explanation is saved and found again. */
export function comparisonKey(input: { hand: readonly number[]; paytableId: string; coins: number; bestMask: number; otherMask: number }) {
  return `${input.hand.join(".")}|${input.paytableId}|${input.coins}|${input.bestMask}|${input.otherMask}`;
}
