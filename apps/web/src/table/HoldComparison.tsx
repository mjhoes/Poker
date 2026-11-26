import { handPaytableId } from "../services/bet";
import { useState } from "react";
import type { Session } from "@perfect-draw/shared";
import { dollarsFor } from "../components/ui";
import { CardFace } from "./CardFace";
import { cardName, maskIndexes, shortCard } from "./cards";
import { gradeLabel } from "./Feedback";
import { compareHolds, comparisonSummary, oneIn } from "./hold-breakdown";
import type { HandAnalysis } from "./hold-breakdown";
import type { HoldComparison as Comparison } from "./hold-breakdown";
import { ExplainPanel } from "../ai/ExplainPanel";
import { familyName } from "../components/UiHelpers";
import { findPaytable } from "../paytables/catalog";

type Grade = NonNullable<Session["state"]["feedback"]>;

/** Colour family for a final hand, shared by the bars and the table. */
function category(rank: string) {
  if (rank.includes("ROYAL")) return "royal";
  if (rank === "STRAIGHT_FLUSH" || rank === "FIVE_KIND") return "sflush";
  if (rank.startsWith("FOUR_")) return "quads";
  return { FULL_HOUSE: "full", FLUSH: "flush", STRAIGHT: "straight", THREE_KIND: "trips", TWO_PAIR: "twopair" }[rank] ?? "pair";
}

/** What a hold's expected value is made of: one segment per final hand, sized by its share of value. */
function EvBar({ label, comparison, side, scale }: { label: string; comparison: Comparison; side: "a" | "b"; scale: number }) {
  const hold = comparison[side];
  return <div className="ev-bar-row">
    <span className="ev-bar-label">{label}</span>
    <span className="ev-bar" role="img" aria-label={`${label}: ${hold.ev.toFixed(2)} credits per line, ${hold.rows.filter(row => row.ev > 0.005).map(row => `${row.name} ${row.ev.toFixed(2)}`).join(", ")}`}>
      {hold.rows.filter(row => row.ev > 0).map(row => <span key={row.rank} className={`ev-seg seg-${category(row.rank)}`}
        style={{ width: `${(row.ev / scale) * 100}%` }} title={`${row.name}: ${row.ev.toFixed(3)} credits`} />)}
    </span>
    <strong className="ev-bar-value">{hold.ev.toFixed(2)}</strong>
  </div>;
}

/** After a hand: the best hold against the player's hold (or the runner-up when the player was right). */
export function HoldComparison({ session, grade }: { session: Session; grade: Grade }) {
  const analysis = session.state.analysis;
  const runnerUp = analysis ? runnerUpMask(analysis.results, grade.bestMask) : null;
  const [other, setOther] = useState(grade.correct ? runnerUp ?? grade.chosenMask : grade.chosenMask);
  if (!analysis || analysis.hand.length !== 5) return null;
  return <HoldComparisonPanel analysis={analysis} bestMask={grade.bestMask} other={other} onOther={setOther}
    mine={grade.correct ? null : grade.chosenMask} denominationCents={session.machineSnapshot.denominationCents}
    context={{ paytableId: handPaytableId(session), coins: session.state.handCoins ?? session.machineSnapshot.coins }} />;
}

/** The strongest hold worth strictly less than the best. */
export function runnerUpMask(results: readonly { mask: number; ev: number }[], bestMask: number) {
  const ranked = [...results].sort((x, y) => y.ev - x.ev);
  const bestEv = results.find(row => row.mask === bestMask)?.ev ?? ranked[0]?.ev ?? 0;
  return (ranked.find(row => row.mask !== bestMask && row.ev < bestEv - 1e-9) ?? ranked.find(row => row.mask !== bestMask))?.mask ?? null;
}

/**
 * Side-by-side breakdown of two holds: for each final hand, how likely it is and what it contributes to expected value
 * (chance × pay). `other` is controlled, so the analyzer's ranked list and the "Compare another hold" controls agree.
 */
export function HoldComparisonPanel({ analysis, bestMask, other, onOther, mine, denominationCents, explore = true, context }: {
  analysis: HandAnalysis & { hand: readonly number[] }; bestMask: number; other: number; onOther: (mask: number) => void;
  /** The player's own hold, named "Your hold" when compared. */ mine: number | null;
  /** Dollars are shown beside credits when known. */ denominationCents: number | null;
  /** Card toggles and top-five shortcuts; the analyzer has its own ranked list instead. */ explore?: boolean;
  /** The table and bet, which the AI explanation names; without it there is no Explain. */ context?: { paytableId: string; coins: number };
}) {
  const ranked = [...analysis.results].sort((x, y) => y.ev - x.ev);
  const runnerUp = runnerUpMask(analysis.results, bestMask);
  const familyId = analysis.familyId;
  const comparison = compareHolds(analysis, bestMask, other);
  const otherName = mine !== null && other === mine ? "Your hold" : other === runnerUp ? "The runner-up" : "This hold";
  const bShort = otherName === "The runner-up" ? "Runner-up" : otherName;
  const scale = Math.max(comparison.a.ev, comparison.b.ev, 1e-9);
  const dollars = (value: number) => denominationCents === null ? "" : ` (${dollarsFor(value, denominationCents)})`;
  const heldShort = (mask: number) => maskIndexes(mask).map(index => shortCard(analysis.hand[index])).join(" ") || "Draw five";
  const holdCards = (mask: number) => maskIndexes(mask).map(index => cardName(analysis.hand[index])).join(", ") || "nothing (draw five)";
  const chosen = mine === null ? undefined : analysis.results.find(row => row.mask === mine);

  return <section className="why" aria-label="Why the best hold is better">
    <p className="why-summary">{comparisonSummary(comparison, { a: "The best hold", b: otherName })}</p>

    <div className="ev-bars">
      <EvBar label="Best hold" comparison={comparison} side="a" scale={scale} />
      <EvBar label={bShort} comparison={comparison} side="b" scale={scale} />
      <p className="ev-legend">{[...new Set(comparison.rows.filter(row => row.a.ev > 0.005 || row.b.ev > 0.005).map(row => category(row.rank)))].map(key =>
        <span key={key}><i className={`ev-swatch seg-${key}`} />{{ royal: "Royal", sflush: "Straight flush", quads: "Four of a kind", full: "Full house", flush: "Flush", straight: "Straight", trips: "Three of a kind", twopair: "Two pair", pair: "High pair" }[key]}</span>)}</p>
    </div>

    <div className="why-table-wrap">
      <table className="why-table">
        <caption className="visually-hidden">Final hands each hold can make, their chances and their share of expected value</caption>
        <thead>
          <tr><th scope="col" rowSpan={2}>Final hand</th><th scope="colgroup" colSpan={2}>Best hold · {heldShort(bestMask)}<span className="why-hold-label">{gradeLabel(comparison.a.label, familyId)}</span></th><th scope="colgroup" colSpan={2}>{bShort} · {heldShort(other)}<span className="why-hold-label">{gradeLabel(comparison.b.label, familyId)}</span></th><th scope="col" rowSpan={2}>Difference</th></tr>
          <tr><th scope="col">Chance</th><th scope="col">Value</th><th scope="col">Chance</th><th scope="col">Value</th></tr>
        </thead>
        <tbody>{comparison.rows.map(row => <tr key={row.rank} className={comparison.decisive.includes(row.rank) ? "is-decisive" : ""}>
          <th scope="row"><i className={`ev-swatch seg-${category(row.rank)}`} />{row.name}<span className="why-pay"> pays {row.a.pay.toLocaleString("en-US")}</span></th>
          <td data-label="Best">{oneIn(row.a.count, comparison.a.drawCount)}</td><td data-label="worth">{row.a.ev.toFixed(2)}</td>
          <td data-label={bShort}>{oneIn(row.b.count, comparison.b.drawCount)}</td><td data-label="worth">{row.b.ev.toFixed(2)}</td>
          <td data-label="Difference" className={row.delta > 0.005 ? "is-plus" : row.delta < -0.005 ? "is-minus" : ""}>{row.delta > 0.005 ? "+" : row.delta < -0.005 ? "−" : ""}{Math.abs(row.delta).toFixed(2)}</td>
        </tr>)}</tbody>
        <tfoot>
          <tr><th scope="row">Wins on</th><td colSpan={2} data-label="Best">{(comparison.a.winProbability * 100).toFixed(1)}% of draws</td><td colSpan={2} data-label={bShort}>{(comparison.b.winProbability * 100).toFixed(1)}% of draws</td><td className="why-empty" /></tr>
          <tr><th scope="row">Expected value</th><td colSpan={2} data-label="Best"><strong>{comparison.a.ev.toFixed(3)}</strong>{dollars(comparison.a.ev)}</td><td colSpan={2} data-label={bShort}><strong>{comparison.b.ev.toFixed(3)}</strong>{dollars(comparison.b.ev)}</td>
            <td data-label="Difference" className={comparison.delta > 0 ? "is-plus" : ""}><strong>{comparison.delta > 0 ? "+" : ""}{comparison.delta.toFixed(3)}</strong></td></tr>
        </tfoot>
      </table>
    </div>
    <p className="why-note">Value = chance × pay, in credits per line at this bet. {comparison.a.drawCount.toLocaleString("en-US")} possible draws for the best hold; {comparison.b.drawCount.toLocaleString("en-US")} for {otherName.toLowerCase().replace(/^the /, "the ")}.</p>
    {context && <ExplainPanel paytableId={context.paytableId} input={{
      hand: analysis.hand, gameName: familyName(familyId), payTableName: findPaytable(context.paytableId)?.name ?? "this pay table", coins: context.coins,
      best: { mask: bestMask, name: gradeLabel(comparison.a.label, familyId) },
      other: { mask: other, name: gradeLabel(comparison.b.label, familyId), role: otherName === "Your hold" ? "Your hold" : otherName === "The runner-up" ? "The runner-up" : "This hold" },
      comparison, summary: comparisonSummary(comparison, { a: "The best hold", b: otherName }),
    }} />}

    {explore && <div className="why-explore">
      <p className="field-label">Compare another hold</p>
      <div className="why-cards" role="group" aria-label="Build a hold to compare">
        {analysis.hand.map((card, index) => {
          const held = (other & (1 << index)) !== 0;
          return <button key={`${card}-${index}`} type="button" className={`why-card ${held ? "is-held" : ""}`} aria-pressed={held}
            aria-label={`${cardName(card)}, ${held ? "held" : "not held"}`} onClick={() => onOther(other ^ (1 << index))}>
            <span className="mini-card"><CardFace card={card} variant="compact" /></span>
          </button>;
        })}
        <span className="why-cards-note">Holding {holdCards(other)}</span>
      </div>
      <div className="why-top" role="group" aria-label="Top holds">
        {ranked.slice(0, 5).map((row, index) => <button key={row.mask} type="button" className={`choice ${row.mask === other ? "selected" : ""}`} aria-pressed={row.mask === other} onClick={() => onOther(row.mask)}>
          <span className="choice-label">{index + 1}. {heldShort(row.mask)}</span>
          <span className="choice-hint">{gradeLabel(row.label, familyId)} · {row.ev.toFixed(3)} credits</span>
        </button>)}
        {chosen && !ranked.slice(0, 5).some(row => row.mask === chosen.mask) && <button type="button" className={`choice ${chosen.mask === other ? "selected" : ""}`} aria-pressed={chosen.mask === other} onClick={() => onOther(chosen.mask)}>
          <span className="choice-label">Your hold · {heldShort(chosen.mask)}</span>
          <span className="choice-hint">{gradeLabel(chosen.label, familyId)} · {chosen.ev.toFixed(3)} credits</span>
        </button>}
      </div>
    </div>}
  </section>;
}
