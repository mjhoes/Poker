import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont } from "pdf-lib";

/*
 * The printable strategy PDF (F6.3, docs/18-PRINTABLE-STRATEGY-PLAN.md): one file with the full chart and your
 * heuristic cards on letter or A4 pages, then a wallet card of the same chart to cut out and fold. Built in the browser
 * with pdf-lib and its standard fonts, so it works offline. Layout is worked out first as a list of drawing steps
 * (`layout`), which the tests read, then drawn.
 */

export type Paper = "letter" | "a4";
export const PAPER_SIZE: Record<Paper, readonly [number, number]> = { letter: [612, 792], a4: [595.28, 841.89] };
export type PrintHeuristic = { rule: string; exceptions: string[]; mnemonic: string; cost: string };
export type PrintContent = {
  /** The game and pay table, e.g. "9/6 Jacks or Better". */
  title: string;
  /** The chart's tier, e.g. "Expert". */
  tier: string;
  /** The chart's bet and return. */
  subtitle: string;
  /** How to read the chart: printed under the title. */
  howTo: string[];
  /** How to read the chart, in a line, under the wallet card's title. */
  walletNote: string;
  /** The chart's lines, numbered on through every section (Deuces Wild charts come by deuces held). */
  sections: { title?: string; lines: string[] }[];
  heuristics: PrintHeuristic[];
  /** Under "Your heuristics": the bet they were scored at. */
  heuristicsNote: string;
  /** Printed at the foot of every page. */
  footer: string;
};

type FontName = "regular" | "bold" | "italic";
type Tone = "ink" | "muted" | "rule";
export type DrawStep =
  | { kind: "text"; page: number; x: number; y: number; text: string; font: FontName; size: number; tone: Tone }
  | { kind: "line"; page: number; x1: number; y1: number; x2: number; y2: number; dashed: boolean; tone: Tone };
export type Layout = {
  pages: number;
  /** Pages of the chart and heuristics, before the wallet card's page. */
  fullPages: number;
  steps: DrawStep[];
  wallet: { panels: WalletPanels; size: number; truncated: boolean };
};
type Fonts = Record<FontName, PDFFont>;
/** Wallet panels, two across: one card folded in half, or folded again once or twice. */
export type WalletPanels = 2 | 4 | 6;

export const WALLET_PANEL = { width: 252, height: 144, padding: 8 } as const; // 3.5 × 2 inches, a business card
const MARGIN = 40, FOOTER_Y = 24, GUTTER = 18;
const TONES: Record<Tone, ReturnType<typeof rgb>> = { ink: rgb(0.1, 0.1, 0.12), muted: rgb(0.38, 0.38, 0.42), rule: rgb(0.6, 0.6, 0.64) };

/** Text the standard fonts can print: common symbols spelled out, anything else they lack as "?". Line breaks stay. */
export function printable(font: PDFFont, text: string) {
  const known = new Set(font.getCharacterSet());
  const spelled = text.replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/→/g, "->").replace(/←/g, "<-").replace(/[   ]/g, " ")
    .replace(/♠/g, "s").replace(/♥/g, "h").replace(/♦/g, "d").replace(/♣/g, "c").replace(/\t/g, " ");
  return [...spelled.normalize("NFC")].map(char => char === "\n" || known.has(char.codePointAt(0)!) ? char : [...char.normalize("NFKD")].filter(part => known.has(part.codePointAt(0)!)).join("") || "?").join("");
}

/** Lines of at most `width` points: by words, and a word longer than a line broken where it must be. */
export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      line = "";
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/** A chart line (numbered) or a section title, wrapped to a column's width. */
type Item = { number?: string; rows: string[]; bold: boolean; gapBefore: number };
function chartItems(fonts: Fonts, content: PrintContent, size: number, width: number): Item[] {
  const items: Item[] = [];
  const indent = fonts.regular.widthOfTextAtSize("00. ", size);
  let number = 0;
  for (const section of content.sections) {
    if (section.title) items.push({ rows: wrap(fonts.bold, section.title, size, width), bold: true, gapBefore: items.length ? size * 0.7 : 0 });
    for (const line of section.lines) items.push({ number: `${++number}.`, rows: wrap(fonts.regular, line, size, width - indent), bold: false, gapBefore: 0 });
  }
  return items;
}
/** Text steps for one item whose top edge is at `top` (PDF points, y up) in a column starting at `x`. */
function itemSteps(fonts: Fonts, item: Item, x: number, top: number, size: number, leading: number, gap: number) {
  const indent = item.number ? fonts.regular.widthOfTextAtSize("00. ", size) : 0;
  const out: { x: number; y: number; text: string; font: FontName; tone: Tone }[] = [];
  item.rows.forEach((row, index) => {
    const y = top - gap - (index + 1) * leading + (leading - size); // the baseline sits a descent above the row's foot
    if (index === 0 && item.number) out.push({ x: x + indent - fonts.regular.widthOfTextAtSize(`${item.number} `, size), y, text: item.number, font: "regular", tone: "muted" });
    out.push({ x: x + indent, y, text: row, font: item.bold ? "bold" : "regular", tone: "ink" });
  });
  return out;
}

/** Lays out the whole PDF: full pages, then the wallet card. */
export function layout(fonts: Fonts, content: PrintContent, paper: Paper): Layout {
  const [pageWidth, pageHeight] = PAPER_SIZE[paper];
  const steps: DrawStep[] = [];
  const width = pageWidth - MARGIN * 2, bottom = MARGIN + 14;
  let page = 0, y = pageHeight - MARGIN;
  const text = (value: string, x: number, font: FontName, size: number, tone: Tone = "ink") =>
    steps.push({ kind: "text", page, x, y, text: value, font, size, tone });
  const newPage = () => { page++; y = pageHeight - MARGIN; };
  const paragraph = (value: string, font: FontName, size: number, tone: Tone, indent = 0) => {
    for (const row of wrap(fonts[font], value, size, width - indent)) {
      if (y - size < bottom) newPage();
      y -= size * 1.25; text(row, MARGIN + indent, font, size, tone);
    }
  };

  // Title, bet and return, how to read it.
  // A custom pay table's name can be long (up to 100 characters): the title wraps to the page's width.
  y -= 2; for (const row of wrap(fonts.bold, `${content.title} · ${content.tier} strategy`, 16, width)) { y -= 19; text(row, MARGIN, "bold", 16); }
  y -= 4; paragraph(content.subtitle, "regular", 9.5, "muted");
  y -= 4; for (const note of content.howTo) paragraph(note, "regular", 8, "muted");
  y -= 14; text("Strategy chart", MARGIN, "bold", 11); y -= 6;

  // The chart in two columns, balanced on its first page and carried on to more pages when it's long. A section title
  // starts a column without the gap it has below a line.
  const size = 9, leading = size * 1.25, columnWidth = (width - GUTTER) / 2;
  const items = chartItems(fonts, content, size, columnWidth);
  const height = (item: Item, used: number) => (used ? item.gapBefore : 0) + item.rows.length * leading;
  const fits = (limit: number) => {
    let column = 0, used = 0;
    for (const item of items) {
      if (used + height(item, used) > limit) { column++; used = 0; if (column > 1) return false; }
      used += height(item, used);
    }
    return true;
  };
  const room = y - bottom;
  let limit = room;
  if (fits(room)) { limit = Math.min(room, items.reduce((sum, item, index) => sum + height(item, index), 0) / 2); while (!fits(limit)) limit += 1; }
  let column = 0, top = y, used = 0, deepest = 0;
  for (const item of items) {
    if (used + height(item, used) > limit) {
      column++; used = 0;
      if (column > 1) { newPage(); top = y; column = 0; limit = y - bottom; deepest = 0; }
    }
    const gap = used ? item.gapBefore : 0;
    for (const step of itemSteps(fonts, item, MARGIN + column * (columnWidth + GUTTER), top - used, size, leading, gap))
      steps.push({ kind: "text", page, size, ...step });
    used += height(item, used);
    deepest = Math.max(deepest, used);
  }
  y = top - deepest;

  // Your heuristic cards, each kept on one page.
  if (content.heuristics.length) {
    y -= 18;
    if (y - 40 < bottom) newPage();
    text("Your heuristics", MARGIN, "bold", 11);
    y -= 2; paragraph(content.heuristicsNote, "regular", 8, "muted");
    for (const card of content.heuristics) {
      const rows = [
        ...wrap(fonts.bold, card.rule, 9, width).map(row => ({ row, font: "bold" as const, size: 9, indent: 0, tone: "ink" as const })),
        ...card.exceptions.flatMap(exception => wrap(fonts.regular, exception, 8.5, width - 10).map((row, index) => ({ row: index ? row : `• ${row}`, font: "regular" as const, size: 8.5, indent: index ? 10 : 2, tone: "ink" as const }))),
        ...(card.mnemonic ? wrap(fonts.italic, `“${card.mnemonic}”`, 8.5, width - 10).map(row => ({ row, font: "italic" as const, size: 8.5, indent: 2, tone: "ink" as const })) : []),
        ...wrap(fonts.regular, card.cost, 8, width).map(row => ({ row, font: "regular" as const, size: 8, indent: 0, tone: "muted" as const })),
      ];
      const height = rows.reduce((sum, item) => sum + item.size * 1.3, 0) + 10;
      if (y - height < bottom) newPage();
      y -= 10;
      for (const item of rows) { y -= item.size * 1.3; text(item.row, MARGIN + item.indent, item.font, item.size, item.tone); }
    }
  }
  const fullPages = page + 1;

  // The wallet card: the chart again, small, on panels of a business card's size to cut out and fold.
  newPage();
  text("Wallet card", MARGIN, "bold", 11);
  y -= 2; paragraph("Cut along the solid line and fold along the dashed lines. Check a casino's house rules before using a strategy card at the table.", "regular", 8, "muted");
  const wallet = walletLayout(fonts, content);
  const panelsWide = 2, panelsHigh = wallet.panels / 2;
  const left = (pageWidth - panelsWide * WALLET_PANEL.width) / 2, topEdge = y - 16;
  for (const step of wallet.steps) {
    const col = step.panel % panelsWide, row = Math.floor(step.panel / panelsWide);
    steps.push({ kind: "text", page, x: left + col * WALLET_PANEL.width + WALLET_PANEL.padding + step.x,
      y: topEdge - row * WALLET_PANEL.height - WALLET_PANEL.padding - step.y, text: step.text, font: step.font, size: step.size, tone: step.tone });
  }
  const right = left + panelsWide * WALLET_PANEL.width, lowEdge = topEdge - panelsHigh * WALLET_PANEL.height;
  const line = (x1: number, y1: number, x2: number, y2: number, dashed: boolean) => steps.push({ kind: "line", page, x1, y1, x2, y2, dashed, tone: "rule" });
  line(left, topEdge, right, topEdge, false); line(right, topEdge, right, lowEdge, false);
  line(right, lowEdge, left, lowEdge, false); line(left, lowEdge, left, topEdge, false);
  line(left + WALLET_PANEL.width, topEdge, left + WALLET_PANEL.width, lowEdge, true);
  for (let row = 1; row < panelsHigh; row++) line(left, topEdge - row * WALLET_PANEL.height, right, topEdge - row * WALLET_PANEL.height, true);

  // Every page's foot.
  const pages = page + 1;
  for (let index = 0; index < pages; index++) {
    const label = `Page ${index + 1} of ${pages}`;
    const labelWidth = fonts.regular.widthOfTextAtSize(label, 7);
    const foot = wrap(fonts.regular, content.footer, 7, width - labelWidth - 12)[0];
    steps.push({ kind: "text", page: index, x: MARGIN, y: FOOTER_Y, text: foot, font: "regular", size: 7, tone: "muted" });
    steps.push({ kind: "text", page: index, x: pageWidth - MARGIN - labelWidth, y: FOOTER_Y, text: label, font: "regular", size: 7, tone: "muted" });
  }
  return { pages, fullPages, steps, wallet: { panels: wallet.panels, size: wallet.size, truncated: wallet.truncated } };
}

type PanelStep = { panel: number; x: number; y: number; text: string; font: FontName; size: number; tone: Tone };
const PANEL_WIDTH = WALLET_PANEL.width - WALLET_PANEL.padding * 2, PANEL_HEIGHT = WALLET_PANEL.height - WALLET_PANEL.padding * 2;
/**
 * The chart on `panels` wallet panels at `size` points, or null when it doesn't fit. A step's y is its baseline's depth
 * below the top of the panel's printable area.
 */
function walletAttempt(fonts: Fonts, content: PrintContent, size: number, panels: number): PanelStep[] | null {
  const leading = size * 1.2, steps: PanelStep[] = [];
  let panel = 0, used = 0;
  for (const row of wrap(fonts.bold, `${content.title} · ${content.tier}`, size + 0.5, PANEL_WIDTH)) {
    used += leading; steps.push({ panel, x: 0, y: used - (leading - size), text: row, font: "bold", size: size + 0.5, tone: "ink" });
  }
  for (const row of wrap(fonts.regular, content.walletNote, size, PANEL_WIDTH)) {
    used += leading; steps.push({ panel, x: 0, y: used - (leading - size), text: row, font: "regular", size, tone: "muted" });
  }
  used += leading * 0.3;
  for (const item of chartItems(fonts, content, size, PANEL_WIDTH)) {
    if (used + (used ? item.gapBefore : 0) + item.rows.length * leading > PANEL_HEIGHT) {
      panel++; used = 0;
      if (panel >= panels) return null;
    }
    const gap = used ? item.gapBefore : 0;
    for (const step of itemSteps(fonts, item, 0, -used, size, leading, gap)) steps.push({ panel, size, ...step, y: -step.y });
    used += gap + item.rows.length * leading;
  }
  return steps;
}
/**
 * The wallet card's chart: the largest type that fits on two panels (one card folded in half), down to 6 points; else
 * four panels (folded twice), down to 5.5 points; else six (two across, three down), down to 5 points; else as much as
 * fits on six at 5 points, and a pointer to the full pages.
 */
export function walletLayout(fonts: Fonts, content: PrintContent) {
  const plans: [WalletPanels, number[]][] = [[2, [7, 6.5, 6]], [4, [7, 6.5, 6, 5.5]], [6, [6.5, 6, 5.5, 5]]];
  for (const [panels, sizes] of plans) for (const size of sizes) {
    const steps = walletAttempt(fonts, content, size, panels);
    if (steps) return { panels, size, truncated: false, steps };
  }
  const total = content.sections.reduce((sum, section) => sum + section.lines.length, 0);
  for (let keep = total - 1; keep > 0; keep--) {
    let left = keep;
    const sections = content.sections.map(section => { const lines = section.lines.slice(0, Math.max(0, left)); left -= lines.length; return { ...section, lines }; })
      .filter(section => section.lines.length);
    const last = sections.length - 1;
    sections[last] = { ...sections[last], lines: [...sections[last].lines, "The rest of the chart is on the full pages."] };
    const steps = walletAttempt(fonts, { ...content, sections }, 5, 6);
    if (steps) return { panels: 6 as WalletPanels, size: 5, truncated: true, steps };
  }
  return { panels: 6 as WalletPanels, size: 5, truncated: true, steps: [] as PanelStep[] };
}

/** The PDF's bytes, and its layout. */
export async function buildStrategyPdf(content: PrintContent, paper: Paper, createdAt = new Date()) {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const clean = (value: string) => printable(fonts.regular, value);
  const safe: PrintContent = {
    ...content, title: clean(content.title), tier: clean(content.tier), subtitle: clean(content.subtitle), howTo: content.howTo.map(clean), walletNote: clean(content.walletNote),
    sections: content.sections.map(section => ({ ...(section.title ? { title: clean(section.title) } : {}), lines: section.lines.map(clean) })),
    heuristics: content.heuristics.map(card => ({ rule: clean(card.rule), exceptions: card.exceptions.map(clean), mnemonic: clean(card.mnemonic), cost: clean(card.cost) })),
    heuristicsNote: clean(content.heuristicsNote), footer: clean(content.footer),
  };
  const result = layout(fonts, safe, paper);
  const [pageWidth, pageHeight] = PAPER_SIZE[paper];
  const pages = Array.from({ length: result.pages }, () => pdf.addPage([pageWidth, pageHeight]));
  for (const step of result.steps) {
    if (step.kind === "text") pages[step.page].drawText(step.text, { x: step.x, y: step.y, size: step.size, font: fonts[step.font], color: TONES[step.tone] });
    else pages[step.page].drawLine({ start: { x: step.x1, y: step.y1 }, end: { x: step.x2, y: step.y2 }, thickness: 0.6, color: TONES[step.tone], ...(step.dashed ? { dashArray: [3, 3] } : {}) });
  }
  pdf.setTitle(`${safe.title} · ${safe.tier} strategy`);
  pdf.setAuthor("Perfect Draw"); pdf.setCreator("Perfect Draw"); pdf.setProducer("Perfect Draw (pdf-lib)");
  pdf.setCreationDate(createdAt); pdf.setModificationDate(createdAt);
  return { bytes: await pdf.save(), layout: result };
}
