import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { uuid } from "@perfect-draw/shared";
import type { RuleAST } from "@perfect-draw/engine";
import { db, requireRecord } from "../data/db";
import { ruleWords } from "../heuristics/rules";
import type { PrintContent, PrintHeuristic } from "../print/strategy-pdf";
import { ALTERNATIVES_NOTE, chartLineText } from "../training/chart-text";
import type { LadderChart, LadderTier } from "../worker/engine-api";
import { heuristicService } from "./heuristics";
import type { HeuristicCard } from "./heuristics";
import { trainingService } from "./training";

/*
 * What the printable strategy PDF holds (docs/18-PRINTABLE-STRATEGY-PLAN.md): a machine's pay table's strategy chart at
 * a tier (the charts are for max bet, 5 coins), and the machine's heuristic cards that aren't archived. The PDF itself
 * is drawn by print/strategy-pdf.ts, loaded only when asked for.
 */

export const PRINT_TIERS: readonly LadderTier[] = ["Beginner", "Intermediate", "Expert"];
const percent = (value: number) => value > 0 && value < 0.001 ? "under 0.001%" : `${value.toFixed(3)}%`;

async function tableName(paytableId: string) {
  const library = PAY_TABLE_LIBRARY.find(table => table.id === paytableId);
  if (library) return library.name;
  return (await db.records("paytables").get(paytableId))?.name ?? "Custom pay table";
}
/** A Deuces Wild line under its section's title ("1 deuce held") doesn't need to say the deuces held again. */
export const withoutDeuceCount = (text: string) =>
  text.replace(/ \((?:no deuces|one deuce|[2-4] deuces) held\)/g, "").replace(/; (?:no deuces|one deuce|[2-4] deuces) held\)/g, ")");

/** A heuristic card as printed: its words (and, under AI words, the engine's), mnemonic and the engine's figures. */
export function printHeuristic(card: HeuristicCard, familyId: string): PrintHeuristic {
  const exact = card.aiModel ? Object.values(ruleWords(card.ruleAst as unknown as RuleAST, familyId)).flat().join(" ") : "";
  const cost = [
    `Costs ${percent(card.costPct)} of return if followed${card.exceptions.length ? ` (${percent(card.costWithoutExceptionsPct)} without the exceptions)` : ""}`,
    `decides ${(card.appliesFreq * 1000).toFixed(1)} of every 1,000 deals`, `right on ${(card.rightFreq * 100).toFixed(1)}% of them`,
  ].join(" · ");
  return { rule: card.ruleText, exceptions: card.exceptions, mnemonic: card.mnemonic, cost: exact ? `${cost}. The engine's rule: ${exact}` : `${cost}.` };
}

/** The chart and cards to print for a machine, laid out as content for the PDF. */
export function printContent(input: { title: string; chart: LadderChart; coins: number; cards: readonly HeuristicCard[]; date: Date }): PrintContent {
  const { chart } = input;
  const lines = chart.lines.map(line => chartLineText(line, chart.familyId));
  const grouped = chart.lines.some(line => line.alternatives?.length);
  const sections = chart.sections?.length
    ? chart.sections.map(section => ({ title: section.title.charAt(0).toUpperCase() + section.title.slice(1), lines: lines.slice(section.startRank, section.endRank).map(withoutDeuceCount) }))
    : [{ lines }];
  return {
    title: input.title, tier: chart.tier,
    subtitle: `For a max bet of 5 coins. Played exactly, this chart returns ${chart.returnPct.toFixed(2)}% (perfect play ${chart.optimalReturnPct.toFixed(2)}%).`,
    howTo: [
      "Read from the top: hold the cards of the first line your hand matches.",
      ...(grouped ? [ALTERNATIVES_NOTE] : []),
      "Draws don't overlap: royal draws are separate from other straight-flush and flush draws, and straight-flush draws from flush and straight draws.",
      `Only when your hand has two holds of that very same name: ${chart.tieBreakRule}`,
    ],
    walletNote: grouped ? "Hold the first match from the top. With “else”, the first one your hand has." : "Hold the first match from the top.",
    sections,
    heuristics: input.cards.map(card => printHeuristic(card, chart.familyId)),
    heuristicsNote: `Scored at ${input.coins} ${input.coins === 1 ? "coin" : "coins"} on this pay table over every deal. Cost is the share of return you give up by following a card instead of perfect play.`,
    footer: `Perfect Draw · ${input.date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} · Check a casino's house rules before using a strategy card at the table.`,
  };
}

export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const printService = {
  /** The content and file name of a machine's strategy PDF at a tier. */
  async strategy(machineId: string, tier: LadderTier, date = new Date()) {
    uuid.parse(machineId);
    const machine = await requireRecord("machines", machineId);
    const [title, chart, cards] = await Promise.all([
      tableName(machine.paytableId), trainingService.ladderChart(machine.paytableId, tier), heuristicService.cards(),
    ]);
    const mine = cards.filter(card => card.paytableId === machine.paytableId && card.coins === machine.coins && card.status !== "archived")
      .sort((a, b) => a.createdAt - b.createdAt);
    return { content: printContent({ title, chart, coins: machine.coins, cards: mine, date }), filename: `perfect-draw-${slug(title)}-${tier.toLowerCase()}.pdf` };
  },
};
