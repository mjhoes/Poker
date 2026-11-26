import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describeHold, getCanonicalHands, isChartLabel, parseHand, preferHold, refinementKey, registerTrainingAnalysis, strategyChoice } from "@perfect-draw/engine";
import type { Card, HandAnalysis } from "@perfect-draw/engine";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { loadPrecomputedAnalysis, loadPrecomputedManifest } from "@perfect-draw/precomputed";
import type { PrecomputedGameAnalysis, PrecomputedManifest } from "@perfect-draw/precomputed";
import { heuristicSchema, newId } from "@perfect-draw/shared";
import { buildStrategyPdf, layout, PAPER_SIZE, printable, WALLET_PANEL, wrap } from "../src/print/strategy-pdf";
import type { Layout, Paper, PrintContent } from "../src/print/strategy-pdf";
import { PRINT_TIERS, printContent, printHeuristic, slug, withoutDeuceCount } from "../src/services/print";
import { ALTERNATIVES_JOIN } from "../src/training/chart-text";
import { gradeLabel } from "../src/table/Feedback";
import type { LadderChart, LadderTier } from "../src/worker/engine-api";

/*
 * The printable strategy PDF on the real charts of every library pay table: every chart line printed on the full pages
 * and on the wallet card, everything inside its page or panel, and a PDF that opens. Set PRINT_SAMPLES=<dir> to keep
 * sample files to look at.
 */
const assets = fileURLToPath(new URL("../../../packages/precomputed/assets/", import.meta.url));
const fromDisk = (async (url: string) => new Response(await readFile(assets + url.split("/").pop()))) as unknown as typeof fetch;
let manifest: PrecomputedManifest;
const analyses = new Map<string, PrecomputedGameAnalysis>();
beforeAll(async () => { manifest = await loadPrecomputedManifest({ fetch: fromDisk }); });
async function analysis(id: string) {
  if (!analyses.has(id)) analyses.set(id, await loadPrecomputedAnalysis(id, manifest, { fetch: fromDisk }));
  return analyses.get(id)!;
}
/** The chart as the engine worker gives it (`ladderChart`), from the table's precomputed analysis. */
async function chartFor(paytableId: string, tier: LadderTier): Promise<LadderChart> {
  const value = await analysis(paytableId);
  const list = value.strategyLists.find(item => item.tier === tier)!;
  return {
    familyId: list.familyId, tier, returnPct: list.returnPct, optimalReturnPct: value.returnPct,
    lines: list.lines.map(line => ({ label: line.label, ...(line.alternatives ? { alternatives: [...line.alternatives] } : {}), freq: line.freq, dealable: true })),
    ...(list.sections ? { sections: list.sections.map(section => ({ title: section.title, startRank: section.startRank, endRank: section.endRank })) } : {}),
    tieBreakRule: list.tieBreakRule,
  };
}
const jacks = PAY_TABLE_LIBRARY.find(table => table.slug === "jacks-or-better-9-6")!;
function card(overrides: Partial<ReturnType<typeof heuristicSchema.parse>> = {}) {
  return heuristicSchema.parse({
    id: newId(), createdAt: 1, updatedAt: 1, deletedAt: null, paytableId: jacks.id, coins: 5, source: "lab", targetLabelPair: ["LP", "4FL"],
    ruleAst: { kind: "prefer", prefer: { label: "LP" }, over: { label: "4FL" }, unless: { kind: "rank", rank: "2", in: "held", on: "over" } },
    ruleText: "Hold low pair (Tens or lower) over 4 to a Flush.", mnemonic: "", exceptions: ["When 4 to a Flush includes a 2, hold 4 to a Flush instead."],
    examples: [], costPct: 0.0123, costWithoutExceptionsPct: 0.0456, appliesFreq: 0.0123, rightFreq: 0.81, status: "active", ...overrides,
  });
}
async function fonts() {
  const pdf = await PDFDocument.create();
  return { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), italic: await pdf.embedFont(StandardFonts.HelveticaOblique) };
}
const textOn = (result: Layout, pages: (page: number) => boolean) =>
  result.steps.filter(step => step.kind === "text" && pages(step.page)).map(step => step.kind === "text" ? step.text : "").join(" ");

describe("text for the standard fonts", () => {
  it("keeps what Helvetica can print and spells out or replaces the rest", async () => {
    const { regular } = await fonts();
    expect(printable(regular, "Hold A♠ K♠ — “low pair” ≥ 2 · café")).toBe("Hold As Ks — “low pair” >= 2 · café");
    expect(printable(regular, "Pairs 🂡 stay")).toBe("Pairs ? stay");
    expect(printable(regular, "Pairs stay put,\nbut a 2 says flush.")).toBe("Pairs stay put,\nbut a 2 says flush.");
  });
  it("wraps by words within the width, breaking a word longer than a line", async () => {
    const { regular } = await fonts();
    const rows = wrap(regular, "Hold 4 to an Inside Straight Flush with two high cards over a low pair", 9, 120);
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) expect(regular.widthOfTextAtSize(row, 9)).toBeLessThanOrEqual(120);
    expect(rows.join(" ")).toBe("Hold 4 to an Inside Straight Flush with two high cards over a low pair");
    expect(wrap(regular, "x".repeat(80), 9, 100).every(row => regular.widthOfTextAtSize(row, 9) <= 100)).toBe(true);
    expect(wrap(regular, "Pairs stay put,\nbut a 2 says flush.", 9, 300)).toEqual(["Pairs stay put,", "but a 2 says flush."]);
  });
});

describe("chart lines", () => {
  it("under a Deuces Wild section's title, don't repeat the deuces held", () => {
    expect(withoutDeuceCount("Flush (one deuce held)")).toBe("Flush");
    expect(withoutDeuceCount("4 to a Royal Flush (2 straight patterns; no low-end pattern; no deuces held)")).toBe("4 to a Royal Flush (2 straight patterns; no low-end pattern)");
    expect(withoutDeuceCount("Wild Royal Flush (2 deuces held) or Five of a kind (2 deuces held)")).toBe("Wild Royal Flush or Five of a kind");
  });
});

describe("a heuristic card as printed", () => {
  it("has its words and the engine's figures, and under AI words the engine's rule", () => {
    expect(printHeuristic(card(), "jacks_or_better").cost).toBe("Costs 0.012% of return if followed (0.046% without the exceptions) · decides 12.3 of every 1,000 deals · right on 81.0% of them.");
    const polished = printHeuristic(card({ ruleText: "Keep the low pair over a flush draw.", mnemonic: "Pairs stay", aiModel: "claude-test" }), "jacks_or_better");
    expect(polished.rule).toBe("Keep the low pair over a flush draw.");
    expect(polished.cost).toContain("The engine's rule: Hold low pair (Tens or lower) over 4 to a Flush. When 4 to a Flush includes a 2, hold 4 to a Flush instead.");
  });
});

describe("the strategy PDF on every library table", () => {
  const samples = process.env.PRINT_SAMPLES;
  for (const table of PAY_TABLE_LIBRARY) {
    it(`${table.name}: the whole chart on the full pages and the wallet card, everything inside its page and panel`, async () => {
      const font = await fonts();
      for (const tier of PRINT_TIERS) {
        const chart = await chartFor(table.id, tier);
        const cards = table.id === jacks.id ? [card(), card({ ruleText: "Keep the low pair over a flush draw.", mnemonic: "Pairs stay put,\nbut a 2 says flush.", aiModel: "claude-test" })] : [];
        const content = printContent({ title: table.name, chart, coins: 5, cards, date: new Date("2026-11-26T12:00:00") });
        const lines = content.sections.flatMap(section => section.lines);
        expect(lines).toHaveLength(chart.lines.length);
        if (chart.sections) expect(content.sections.map(section => section.title)).toEqual(["4 deuces held", "3 deuces held", "2 deuces held", "1 deuce held", "0 deuces held"]);
        for (const paper of ["letter", "a4"] as Paper[]) {
          const result = layout(font, content, paper);
          const [width, height] = PAPER_SIZE[paper];
          expect(result.wallet.truncated).toBe(false);
          expect(result.pages).toBe(result.fullPages + 1);
          const full = textOn(result, page => page < result.fullPages), wallet = textOn(result, page => page === result.fullPages);
          lines.forEach((line, index) => { expect(full).toContain(`${index + 1}. ${line}`); expect(wallet).toContain(`${index + 1}. ${line}`); });
          for (const item of cards) expect(full).toContain(item.ruleText);
          // Everything on its page; on the wallet page, chart text inside its panel.
          for (const step of result.steps) {
            if (step.kind !== "text") continue;
            const right = step.x + font[step.font].widthOfTextAtSize(step.text, step.size);
            expect(step.x).toBeGreaterThanOrEqual(39);
            expect(right).toBeLessThanOrEqual(width - 39);
            expect(step.y).toBeGreaterThan(20);
            expect(step.y).toBeLessThan(height - 30);
          }
          const box = result.steps.filter(step => step.kind === "line" && step.page === result.fullPages && !step.dashed);
          const xs = box.flatMap(step => step.kind === "line" ? [step.x1, step.x2] : []), ys = box.flatMap(step => step.kind === "line" ? [step.y1, step.y2] : []);
          const [left, top] = [Math.min(...xs), Math.max(...ys)];
          expect(Math.max(...xs) - left).toBeCloseTo(WALLET_PANEL.width * 2, 5);
          expect(top - Math.min(...ys)).toBeCloseTo(WALLET_PANEL.height * result.wallet.panels / 2, 5);
          const walletSteps = result.steps.filter(step => step.kind === "text" && step.page === result.fullPages && step.y < top && step.y > 30); // not the page foot
          for (const step of walletSteps) {
            if (step.kind !== "text") continue;
            const col = Math.floor((step.x - left) / WALLET_PANEL.width), row = Math.floor((top - step.y) / WALLET_PANEL.height);
            const panelLeft = left + col * WALLET_PANEL.width, panelTop = top - row * WALLET_PANEL.height;
            expect(step.x).toBeGreaterThanOrEqual(panelLeft + WALLET_PANEL.padding - 0.01);
            expect(step.x + font[step.font].widthOfTextAtSize(step.text, step.size)).toBeLessThanOrEqual(panelLeft + WALLET_PANEL.width - WALLET_PANEL.padding + 0.01);
            expect(step.y).toBeLessThanOrEqual(panelTop - WALLET_PANEL.padding);
            expect(step.y).toBeGreaterThanOrEqual(panelTop - WALLET_PANEL.height + WALLET_PANEL.padding - 0.01);
          }
          if (paper === "letter" && tier === "Expert") {
            const { bytes } = await buildStrategyPdf(content, paper);
            const loaded = await PDFDocument.load(bytes);
            expect(loaded.getPageCount()).toBe(result.pages);
            expect(loaded.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
            expect(loaded.getTitle()).toBe(`${table.name} · Expert strategy`);
            if (samples) { await mkdir(samples, { recursive: true }); await writeFile(`${samples}/${slug(table.name)}-expert.pdf`, bytes); }
          }
        }
      }
    }, 120_000);
  }
});

/*
 * The printed chart has to play like the chart whose return it prints. `playPrinted` holds a hand by reading only the
 * PDF's content: lines from the top, a line's holds joined by "else" in order, and the printed tie-break (the engine's
 * hold preference) only among holds of that very same name. A hold answers to its chart category's printed name (and,
 * for the most detailed charts, its general category's too), under its Deuces Wild section's title.
 */
function playPrinted(content: PrintContent, hand: readonly Card[], familyId: string, refinement: number) {
  const section = (label: string) => { const held = Number(label.match(/^D([0-4])_/)?.[1] ?? -1); return held < 0 ? "" : `${held} ${held === 1 ? "deuce" : "deuces"} held`; };
  const name = (label: string) => `${section(label)}|${familyId === "deuces_wild" ? withoutDeuceCount(gradeLabel(label, familyId)) : gradeLabel(label, familyId)}`;
  const names = new Map<number, Set<string>>();
  for (let mask = 0; mask < 32; mask++) {
    const pattern = describeHold(hand as Card[], mask, familyId as never);
    if (!isChartLabel(pattern.base)) continue;
    names.set(mask, new Set([refinementKey(pattern, refinement), ...(refinement === 2 ? [pattern.base] : [])].map(name)));
  }
  for (const part of content.sections) for (const line of part.lines) for (const item of line.split(ALTERNATIVES_JOIN)) {
    const wanted = `${part.title?.toLowerCase() ?? ""}|${item}`;
    const holds = [...names].filter(([, mine]) => mine.has(wanted)).map(([mask]) => mask);
    if (holds.length) return holds.reduce((best, mask) => preferHold(hand as Card[], mask, best, familyId as never) ? mask : best, -1);
  }
  return 0; // no line matches: draw five
}

describe("the printed chart plays like the engine's chart", () => {
  it("9/6 Jacks or Better Beginner: Jc Qs Ah 3d 5c holds QJ, the earlier hold of its line, not AQ", async () => {
    const value = await analysis(jacks.id);
    const list = value.strategyLists.find(item => item.tier === "Beginner")!;
    registerTrainingAnalysis(list.analysisKey, value);
    const content = printContent({ title: jacks.name, chart: await chartFor(jacks.id, "Beginner"), coins: 5, cards: [], date: new Date() });
    const line = content.sections[0].lines.find(text => text.startsWith("Unsuited KQJ"))!;
    expect(line).toBe("Unsuited KQJ, else Unsuited QJ, else Unsuited KJ, else Unsuited KQ, else Unsuited AK, else Unsuited AQ, else Unsuited AJ");
    expect(content.howTo).toContain("Where a line lists holds joined by “else”, they're in order: hold the first one your hand has.");
    expect(content.walletNote).toBe("Hold the first match from the top. With “else”, the first one your hand has.");
    const hand = parseHand("Jc Qs Ah 3d 5c");
    const engine = strategyChoice({ hand, familyId: value.familyId, valueVector: value.valueVector, results: Array.from({ length: 32 }, (_, mask) => ({ mask })) } as unknown as HandAnalysis, list);
    const held = (mask: number) => hand.filter((_, index) => mask & (1 << index));
    expect(held(engine.mask)).toEqual(hand.slice(0, 2)); // Jc Qs
    expect(playPrinted(content, hand, value.familyId, list.refinement)).toBe(engine.mask);
  });
  for (const [slugName, tiers, stride] of [["jacks-or-better-9-6", PRINT_TIERS, 3], ["double-double-bonus-9-6", PRINT_TIERS, 7], ["deuces-wild-nsud", PRINT_TIERS, 7]] as const) {
    it(`${slugName}: one deal in every ${stride} is held as the engine's chart holds it, at every tier`, async () => {
      const table = PAY_TABLE_LIBRARY.find(item => item.slug === slugName)!;
      const value = await analysis(table.id);
      const hands = getCanonicalHands();
      for (const tier of tiers) {
        const list = value.strategyLists.find(item => item.tier === tier)!;
        registerTrainingAnalysis(list.analysisKey, value);
        const content = printContent({ title: table.name, chart: await chartFor(table.id, tier), coins: 5, cards: [], date: new Date() });
        let checked = 0;
        const wrong: string[] = [];
        for (let h = 0; h < hands.length; h += stride) {
          const hand = hands[h].hand;
          const engine = strategyChoice({ hand, familyId: value.familyId, valueVector: value.valueVector, results: Array.from({ length: 32 }, (_, mask) => ({ mask })) } as unknown as HandAnalysis, list);
          if (playPrinted(content, hand, value.familyId, list.refinement) !== engine.mask && wrong.length < 5) wrong.push(`${tier} hand ${h}`);
          checked++;
        }
        expect(wrong).toEqual([]);
        expect(checked).toBeGreaterThan(10_000);
      }
    }, 600_000);
  }
});

describe("long titles", () => {
  it("a custom pay table's 100-character name wraps inside the page, on both papers, in the PDF too", async () => {
    const font = await fonts();
    const chart = await chartFor(jacks.id, "Expert");
    for (const title of ["W".repeat(100), `My favourite downtown casino's ${"very ".repeat(14)}good table`.slice(0, 100)]) {
      const content = printContent({ title, chart, coins: 5, cards: [card()], date: new Date() });
      for (const paper of ["letter", "a4"] as Paper[]) {
        const result = layout(font, content, paper);
        const [width, height] = PAPER_SIZE[paper];
        for (const step of result.steps) {
          if (step.kind !== "text") continue;
          expect(step.x).toBeGreaterThanOrEqual(39);
          expect(step.x + font[step.font].widthOfTextAtSize(step.text, step.size)).toBeLessThanOrEqual(width - 39);
          expect(step.y).toBeLessThan(height - 30);
        }
        const heading = result.steps.filter(step => step.kind === "text" && step.page === 0 && step.font === "bold" && step.size === 16).map(step => step.kind === "text" ? step.text : "");
        expect(heading.length).toBeGreaterThan(1);
        expect(heading.join(" ").replace(/\s+/g, "")).toBe(`${title} · Expert strategy`.replace(/\s+/g, ""));
        // The chart starts below the title.
        const lowest = Math.min(...result.steps.filter(step => step.kind === "text" && step.page === 0 && step.size === 16).map(step => step.kind === "text" ? step.y : 0));
        expect(result.steps.some(step => step.kind === "text" && step.page === 0 && step.text === "Strategy chart" && step.y < lowest)).toBe(true);
        const { bytes } = await buildStrategyPdf(content, paper);
        expect((await PDFDocument.load(bytes)).getPageCount()).toBe(result.pages);
        if (process.env.PRINT_SAMPLES && paper === "letter") await writeFile(`${process.env.PRINT_SAMPLES}/long-title-${title.length}-${title.charAt(0)}.pdf`, bytes);
      }
    }
  });
});
