import { useEffect, useState } from "react";
import type { StrategyTier } from "@perfect-draw/engine";
import type { Hand } from "@perfect-draw/engine";
import type { RecentHand } from "@perfect-draw/shared";
import { Button, Segmented } from "../components/ui";
import { errorMessage } from "../hooks/useActionRunner";
import { findPaytable } from "../paytables/catalog";
import { CardFace } from "../table/CardFace";
import { maskIndexes, shortCard } from "../table/cards";
import { gradeLabel } from "../table/Feedback";
import { engineClient } from "../worker/client";
import type { StrategyCitation } from "../worker/engine-api";
import { compareAcross } from "./ranked-holds";
import type { AcrossResult } from "./ranked-holds";
import type { AnalyzerTarget } from "./targets";

const heldText = (hand: readonly number[], mask: number) => maskIndexes(mask).map(index => shortCard(hand[index])).join(" ") || "Draw five";
const credits = (value: number) => value.toFixed(3);

/** Which line of a strategy chart picks this hand's hold (charts are built for max bet). */
export function StrategyPanel({ cards, paytableId, coins, bestMask, bestEv, onShow }: {
  cards: readonly number[]; paytableId: string; coins: number; bestMask: number; bestEv: number; onShow: (mask: number) => void;
}) {
  const [tier, setTier] = useState<StrategyTier>("Expert");
  const [ready, setReady] = useState<boolean | null>(null);
  const [citation, setCitation] = useState<StrategyCitation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const handKey = cards.join(",");

  useEffect(() => {
    let cancelled = false;
    setReady(null);
    engineClient().hasStrategyCharts(paytableId).then(value => { if (!cancelled) setReady(value); }, () => { if (!cancelled) setReady(false); });
    return () => { cancelled = true; };
  }, [paytableId]);

  useEffect(() => {
    if (coins !== 5 || !ready || cards.length !== 5) return;
    let cancelled = false;
    setLoading(true); setError(""); setCitation(null);
    engineClient().strategyCitation(cards as unknown as Hand, paytableId, tier)
      .then(value => { if (!cancelled) setCitation(value); })
      .catch(reason => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey, paytableId, coins, tier, ready]);

  const differs = citation && citation.mask !== bestMask && citation.ev < bestEv - 1e-9;
  return <section className="panel panel-pad analyzer-panel" aria-label="Strategy chart">
    <div className="analyzer-panel-head"><h2>Strategy chart</h2>
      {coins === 5 && ready && <Segmented label="Chart" value={tier} onChange={setTier}
        options={(["Beginner", "Intermediate", "Expert"] as const).map(value => ({ value, label: value }))} />}
    </div>
    {coins !== 5 ? <p className="analyzer-note">Strategy charts are for max bet. Switch the bet to 5 to see which chart line applies.</p>
      : ready === false ? <div className="analyzer-note">
        <p>This table's charts haven't been built yet. Building them takes about 20 seconds, once; they are then saved on this device.</p>
        <Button variant="secondary" size="sm" onClick={() => setReady(true)}>Build strategy charts</Button>
      </div>
      : loading || ready === null ? <p className="analyzer-note" role="status">{ready === null ? "Checking for charts…" : "Finding the chart line…"}</p>
      : error ? <p className="analyzer-note is-error" role="alert">{error}</p>
      : citation && <div className="citation">
        {citation.line === null
          ? <p className="citation-line"><strong>No line applies</strong> on the {tier} chart: it says to draw five new cards.</p>
          : <p className="citation-line"><span className="citation-where">{tier} chart · line {citation.line + 1} of {citation.lineCount}</span>
            <strong>{gradeLabel(citation.lineLabel!, citation.familyId)}</strong>{citation.exception && <span className="citation-exception"> (an exception on this line)</span>}</p>}
        {differs
          ? <p className="citation-differs">The chart keeps <button type="button" className="link-button" onClick={() => onShow(citation.mask)}>{heldText(cards, citation.mask)}</button> ({gradeLabel(citation.label, citation.familyId)}) instead of the best hold, giving up {credits(bestEv - citation.ev)} credits here. Simpler charts trade a little return for being easier to remember.</p>
          : <p className="citation-agrees">This is the best hold.</p>}
        <p className="analyzer-note">Followed on every hand, the {tier} chart returns {citation.chartReturnPct.toFixed(3)}% (perfect play: {citation.optimalReturnPct.toFixed(3)}%).</p>
      </div>}
  </section>;
}

/** Whether the best hold changes on your other machines and the popular tables. */
export function AcrossPanel({ cards, bestMask, targets }: { cards: readonly number[]; bestMask: number; targets: readonly AnalyzerTarget[] }) {
  const [results, setResults] = useState<AcrossResult[] | null>(null);
  const [error, setError] = useState("");
  const handKey = cards.join(","), targetsKey = targets.map(target => `${target.paytableId}:${target.coins}`).join("|");
  useEffect(() => {
    if (cards.length !== 5) return;
    let cancelled = false;
    setResults(null); setError("");
    engineClient().analyzeAcross(cards as unknown as Hand, targets.map(target => ({ paytableId: target.paytableId, coins: target.coins })))
      .then(rows => {
        if (cancelled) return;
        setResults(rows.map(row => {
          const target = targets.find(item => item.paytableId === row.paytableId && item.coins === row.coins)!;
          return { ...row, name: target.name, machine: target.kind === "machine" };
        }));
      })
      .catch(reason => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey, targetsKey]);
  const rows = results ? compareAcross(bestMask, results) : [];
  const different = rows.filter(row => row.differs).length;
  return <section className="panel panel-pad analyzer-panel" aria-label="Across pay tables">
    <div className="analyzer-panel-head"><h2>On other tables</h2></div>
    {error ? <p className="analyzer-note is-error" role="alert">{error}</p>
      : !results ? <p className="analyzer-note" role="status">Comparing tables…</p>
      : !rows.length ? <p className="analyzer-note">No other tables to compare.</p>
      : <>
        <p className="analyzer-note">{different ? `The best hold changes on ${different} of ${rows.length} tables.` : `The same hold is best on all ${rows.length} tables.`}</p>
        <ul className="across-list">
          {rows.map(row => <li key={`${row.paytableId}:${row.coins}`} className={`across-row ${row.differs ? "is-different" : ""}`}>
            <span className="across-name"><strong>{row.name}</strong><span>{row.machine ? `${findPaytable(row.paytableId)?.name ?? ""} · ` : ""}{row.coins} coin{row.coins === 1 ? "" : "s"}</span></span>
            <span className="across-hold"><span className="across-cards">{heldText(cards, row.bestMask)}</span><span>{gradeLabel(row.bestLabel, row.familyId)}</span></span>
            <span className="across-verdict">{row.differs ? <>Different<span>this hand's best hold costs {credits(row.cost)} here</span></> : "Same"}</span>
          </li>)}
        </ul>
      </>}
  </section>;
}

/** The last 20 analyzed hands; selecting one opens it again. */
export function RecentHands({ hands, onOpen, onClear }: { hands: readonly RecentHand[]; onOpen: (hand: RecentHand) => void; onClear: () => void }) {
  return <section className="panel panel-pad analyzer-panel" aria-label="Recent hands">
    <div className="analyzer-panel-head"><h2>Recent hands</h2>{hands.length > 0 && <button type="button" className="link-button" onClick={onClear}>Clear</button>}</div>
    {!hands.length ? <p className="analyzer-note">Hands you analyze appear here.</p>
      : <ul className="recent-list">{hands.map(hand => <li key={`${hand.at}-${hand.hand.join(",")}`}>
        <button type="button" className="recent-hand" onClick={() => onOpen(hand)} aria-label={`Open ${hand.hand.map(shortCard).join(" ")}, ${findPaytable(hand.paytableId)?.name ?? "pay table"}, ${hand.coins} coins`}>
          <span className="recent-cards" aria-hidden="true">{hand.hand.map(card => <span key={card} className="mini-card"><CardFace card={card} variant="compact" /></span>)}</span>
          <span className="recent-meta"><strong>{findPaytable(hand.paytableId)?.name ?? "Deleted pay table"}</strong><span>{hand.coins} coin{hand.coins === 1 ? "" : "s"} · {relativeTime(hand.at)}</span></span>
        </button>
      </li>)}</ul>}
  </section>;
}

function relativeTime(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
