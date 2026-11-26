import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { loadPrecomputedAnalysis, loadPrecomputedManifest } from "@perfect-draw/precomputed";
import type { PrecomputedGameAnalysis, PrecomputedManifest } from "@perfect-draw/precomputed";
import { heuristicSchema, newId } from "@perfect-draw/shared";
import { buildStrategyPdf, layout, PAPER_SIZE, printable, WALLET_PANEL, wrap } from "../src/print/strategy-pdf";
import type { Layout, Paper } from "../src/print/strategy-pdf";
import { PRINT_TIERS, printContent, printHeuristic, slug, withoutDeuceCount } from "../src/services/print";
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
