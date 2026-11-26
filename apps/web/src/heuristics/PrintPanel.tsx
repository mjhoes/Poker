import { useState } from "react";
import type { Machine } from "@perfect-draw/shared";
import { Button, ChoiceChips } from "../components/ui";
import { errorMessage } from "../hooks/useActionRunner";
import type { Paper } from "../print/strategy-pdf";
import { PRINT_TIERS, printService } from "../services/print";
import type { LadderTier } from "../worker/engine-api";

/** Letter paper where it's the usual size; A4 everywhere else. */
export function defaultPaper(language = typeof navigator === "undefined" ? "en-US" : navigator.language): Paper {
  try {
    const region = new Intl.Locale(language).maximize().region ?? "";
    return ["US", "CA", "MX", "PH", "PR", "CL", "CO", "VE", "GT", "CR", "PA", "DO", "SV", "NI", "HN"].includes(region) ? "letter" : "a4";
  } catch { return "a4"; }
}

/** Hands the browser a file to save. */
function saveFile(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * The printable strategy (docs/18-PRINTABLE-STRATEGY-PLAN.md): one PDF with the chart at a tier and the machine's
 * heuristic cards on full pages, then a wallet card. Built here in the browser; pdf-lib loads only when asked for.
 */
export function PrintPanel({ machine, cardCount, busy }: { machine: Machine; cardCount: number; busy: boolean }) {
  const [tier, setTier] = useState<LadderTier>("Expert");
  const [paper, setPaper] = useState<Paper>(() => defaultPaper());
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const download = async () => {
    setWorking(true); setResult(null);
    try {
      const { content, filename } = await printService.strategy(machine.id, tier);
      const { buildStrategyPdf } = await import("../print/strategy-pdf");
      const { bytes, layout } = await buildStrategyPdf(content, paper);
      saveFile(bytes, filename);
      setResult({ ok: true, text: `Saved ${filename}: ${layout.fullPages} ${layout.fullPages === 1 ? "page" : "pages"} and a wallet card of ${layout.wallet.panels} panels.` });
    } catch (reason) { setResult({ ok: false, text: `Couldn't make the PDF: ${errorMessage(reason)}` }); }
    finally { setWorking(false); }
  };
  return <section className="panel panel-pad print-panel" aria-labelledby="print-title">
    <p className="eyebrow">PRINT</p><h2 id="print-title">Take your strategy with you</h2>
    <p className="train-copy">One PDF: the chart for this pay table at max bet{cardCount ? <>, your {cardCount} heuristic {cardCount === 1 ? "card" : "cards"}</> : null} on full pages, then a wallet card to cut out and fold. Check a casino's house rules before using a strategy card at the table.</p>
    <div className="train-actions">
      <ChoiceChips label="Chart" value={tier} onChange={(value: LadderTier) => setTier(value)}
        choices={PRINT_TIERS.map(item => ({ value: item, label: item, hint: item === "Beginner" ? "The fewest lines" : item === "Intermediate" ? "More lines, closer to perfect play" : "The most lines, the closest to perfect play" }))} />
      <label className="field print-paper"><span className="field-label">Paper</span>
        <select aria-label="Paper" value={paper} onChange={event => setPaper(event.target.value as Paper)}>
          <option value="letter">Letter</option><option value="a4">A4</option>
        </select></label>
      <Button variant="gold" icon="download" loading={working} loadingLabel="Making your PDF…" disabled={busy} onClick={() => void download()}>Download PDF</Button>
    </div>
    {working && <p className="status-note" role="status">A table's first chart takes about 20 seconds.</p>}
    {result && <p className={result.ok ? "status-note" : "explain-error"} role={result.ok ? "status" : "alert"}>{result.text}</p>}
  </section>;
}
