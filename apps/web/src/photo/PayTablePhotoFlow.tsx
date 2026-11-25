import { useEffect, useState } from "react";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { Button } from "../components/ui";
import { familyName } from "../components/UiHelpers";
import type { Run } from "../hooks/useActionRunner";
import { errorMessage } from "../hooks/useActionRunner";
import { modelInfo, formatCost } from "../ai/models";
import { findPaytable } from "../paytables/catalog";
import { PayTableEditor } from "../paytables/PayTableEditor";
import { useLibraryReturns } from "../machines/machine-info";
import type { SaveResult } from "../services/paytables";
import { useAppStore } from "../state/app-store";
import { CardFace } from "../table/CardFace";
import { gradeLabel } from "../table/Feedback";
import { strategyDifferenceInWorker } from "../worker/client";
import type { StrategyDifference } from "../worker/engine-api";
import { closestLibraryTable, returnRank } from "./closest-table";
import type { PreparedImage } from "./image";
import { PhotoReader } from "./PhotoReader";
import type { PhotoResult } from "./PhotoReader";
import { readPaytable } from "./paytable-photo";
import type { PaytableReply } from "./paytable-photo";

/** After saving: the table's return, its place among the built-in tables of the game, and how its strategy differs. */
export function PhotoTableSummary({ result }: { result: SaveResult }) {
  const table = findPaytable(result.id, useAppStore(state => state.paytables));
  const stored = useAppStore(state => state.paytables.find(row => row.id === result.id));
  const returns = useLibraryReturns();
  const [difference, setDifference] = useState<StrategyDifference | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const base = table && result.matched !== "library" ? closestLibraryTable({ familyId: table.familyId, pays: Object.fromEntries(Object.entries(table.pays).map(([rank, row]) => [rank, [...row] as [number, number, number, number, number]])) })?.table : null;

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    setProgress(0);
    strategyDifferenceInWorker(result.id, base.id, value => { if (!cancelled && value.total) setProgress(value.completed / value.total); })
      .then(value => { if (!cancelled) setDifference(value); })
      .catch(reason => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setProgress(null); });
    return () => { cancelled = true; };
  }, [result.id, base?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!table) return null;
  const returnPct = result.matched === "library" ? returns.get(table.id) : stored?.computed?.returnPct;
  const family = PAY_TABLE_LIBRARY.filter(item => item.familyId === table.familyId && item.id !== table.id).flatMap(item => returns.get(item.id) ?? []);
  const rank = returnPct !== undefined && family.length ? returnRank(returnPct, family) : null;
  return <section className="photo-summary" aria-label="Your pay table">
    <p className="eyebrow">{result.matched === "library" ? "BUILT-IN TABLE" : "SAVED"}</p>
    <h3>{table.name}</h3>
    <dl className="photo-facts">
      <div><dt>Return with perfect play</dt><dd>{returnPct !== undefined ? `${returnPct.toFixed(3)}%` : "—"}</dd></div>
      {rank && <div><dt>Among {familyName(table.familyId)} tables</dt><dd>{rank.place === 1 ? "Highest" : `${rank.place} of ${rank.of}`} by return</dd></div>}
    </dl>
    {result.matched === "library" ? <p className="ai-note">This is one of the app's built-in tables, with ready-made strategy charts.</p>
      : base && <div className="photo-strategy">
        {difference ? <>
          <p><strong>{difference.differPct < 0.005 ? "The best hold is the same on every deal" : `The best hold changes on ${difference.differPct < 0.1 ? difference.differPct.toFixed(2) : difference.differPct.toFixed(1)}% of deals`}</strong> compared with {base.name}.</p>
          {difference.examples.length > 0 && <ul className="photo-examples">{difference.examples.map((example, index) => <li key={index}>
            <span className="photo-example-cards" aria-label={`Hand ${index + 1}`}>{example.hand.map(card => <span key={card} className="mini-card"><CardFace card={card} variant="compact" /></span>)}</span>
            <span>Here: <strong>{gradeLabel(example.best, table.familyId)}</strong> · on {base.name}: {gradeLabel(example.baseBest, table.familyId)}</span>
          </li>)}</ul>}
        </> : error ? <p className="explain-error" role="alert">{error}</p>
          : <div className="photo-progress" role="status"><span>Comparing strategy with {base.name}… the full analysis takes about 20 seconds, once.</span>
            <progress max={1} value={progress ?? 0} aria-label="Analysis progress" /></div>}
      </div>}
  </section>;
}

/**
 * Pay table from a photo: read it, confirm it in the editor (doubtful rows highlighted, the photo alongside), save, then
 * see what the table is worth. The photo is only in memory and is dropped when this closes.
 */
export function PayTablePhotoFlow({ busy, run, onCancel, onSaved, onDone, initialImage, doneLabel = "Done" }: {
  busy: boolean; run: Run; onCancel: () => void; onSaved?: (result: SaveResult) => void; onDone: (result: SaveResult) => void;
  initialImage?: PreparedImage; doneLabel?: string;
}) {
  const [read, setRead] = useState<PhotoResult<"paytable"> | null>(null);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState<SaveResult | null>(null);
  // A photo taken here is dropped when the flow closes; one handed in (from a hand photo) belongs to the caller.
  useEffect(() => () => { if (read && read.image !== initialImage) URL.revokeObjectURL(read.image.previewUrl); }, [read, initialImage]);

  if (saved) return <div className="photo-flow">
    <PhotoTableSummary result={saved} />
    <div className="form-actions"><Button onClick={() => onDone(saved)}>{doneLabel}</Button></div>
  </div>;
  if (read) return <PayTableEditor busy={busy} run={run} onCancel={onCancel}
    photo={{ reply: read.reply as PaytableReply, imageUrl: read.image.previewUrl, source: `Read by ${modelInfo(read.model)?.name ?? read.model}${read.cached ? " (from this device, no new cost)" : ` · ${formatCost(read.cost)}`}` }}
    onSaved={result => { onSaved?.(result); setSaved(result); }} />;
  return <div className="photo-flow">
    <PhotoReader kind="paytable" initialImage={initialImage} error={problem} onRead={result => {
      const reply = result.reply as PaytableReply;
      if (!reply.readable || !reply.rows.length) { setProblem("No pay table was found in that photo. Try a straight-on shot of the whole pay table."); return; }
      const reading = readPaytable(reply);
      if (reading.unknown.length === reply.rows.length) { setProblem("The rows in that photo didn't look like a video poker pay table. Try a clearer shot."); return; }
      setProblem(""); setRead(result);
    }} />
    <div className="form-actions"><Button variant="secondary" onClick={onCancel}>Cancel</Button></div>
  </div>;
}
