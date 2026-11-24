import { useState } from "react";
import type { Session } from "@perfect-draw/shared";
import { dollarsFor } from "../components/ui";
import { CardFace } from "./CardFace";
import { cardName, maskIndexes, shortCard } from "./cards";
import { gradeLabel } from "./Feedback";
import { compareHolds, comparisonSummary, oneIn } from "./hold-breakdown";
import type { HoldComparison as Comparison } from "./hold-breakdown";

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

/**
 * Side-by-side breakdown of two holds: for each final hand, how likely it is and what it contributes to expected value
 * (chance × pay). The best hold is compared with the player's hold, the runner-up, or any hold the player builds.
 */
export function HoldComparison({ session, grade }: { session: Session; grade: Grade }) {
  const analysis = session.state.analysis;
  const ranked = analysis ? [...analysis.results].sort((x, y) => y.ev - x.ev) : [];
  const runnerUp = ranked.find(row => row.mask !== grade.bestMask && row.ev < grade.bestEv - 1e-9) ?? ranked[1];
  const [other, setOther] = useState(grade.correct ? runnerUp?.mask ?? grade.chosenMask : grade.chosenMask);
  if (!analysis || analysis.hand.length !== 5) return null;
  const familyId = analysis.familyId;
  const comparison = compareHolds(analysis, grade.bestMask, other);
  const otherName = other === grade.chosenMask && !grade.correct ? "Your hold" : other === runnerUp?.mask ? "The runner-up" : "This hold";
  const bShort = otherName === "The runner-up" ? "Runner-up" : otherName;
  const scale = Math.max(comparison.a.ev, comparison.b.ev, 1e-9);
  const denomination = session.machineSnapshot.denominationCents;
  const heldShort = (mask: number) => maskIndexes(mask).map(index => shortCard(analysis.hand[index])).join(" ") || "Draw five";
  const holdCards = (mask: number) => maskIndexes(mask).map(index => cardName(analysis.hand[index])).join(", ") || "nothing (draw five)";

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
          <tr><th scope="col" rowSpan={2}>Final hand</th><th scope="colgroup" colSpan={2}>Best hold · {heldShort(grade.bestMask)}<span className="why-hold-label">{gradeLabel(grade.bestLabel, familyId)}</span></th><th scope="colgroup" colSpan={2}>{bShort} · {heldShort(other)}<span className="why-hold-label">{gradeLabel(comparison.b.label, familyId)}</span></th><th scope="col" rowSpan={2}>Difference</th></tr>
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
          <tr><th scope="row">Expected value</th><td colSpan={2} data-label="Best"><strong>{comparison.a.ev.toFixed(3)}</strong> ({dollarsFor(comparison.a.ev, denomination)})</td><td colSpan={2} data-label={bShort}><strong>{comparison.b.ev.toFixed(3)}</strong> ({dollarsFor(comparison.b.ev, denomination)})</td>
            <td data-label="Difference" className={comparison.delta > 0 ? "is-plus" : ""}><strong>{comparison.delta > 0 ? "+" : ""}{comparison.delta.toFixed(3)}</strong></td></tr>
        </tfoot>
      </table>
    </div>
    <p className="why-note">Value = chance × pay, in credits per line at this bet. {comparison.a.drawCount.toLocaleString("en-US")} possible draws for the best hold; {comparison.b.drawCount.toLocaleString("en-US")} for {otherName.toLowerCase().replace(/^the /, "the ")}.</p>

    <div className="why-explore">
      <p className="field-label">Compare another hold</p>
      <div className="why-cards" role="group" aria-label="Build a hold to compare">
        {analysis.hand.map((card, index) => {
          const held = (other & (1 << index)) !== 0;
          return <button key={`${card}-${index}`} type="button" className={`why-card ${held ? "is-held" : ""}`} aria-pressed={held}
            aria-label={`${cardName(card)}, ${held ? "held" : "not held"}`} onClick={() => setOther(other ^ (1 << index))}>
            <span className="mini-card"><CardFace card={card} variant="compact" /></span>
          </button>;
        })}
        <span className="why-cards-note">Holding {holdCards(other)}</span>
      </div>
      <div className="why-top" role="group" aria-label="Top holds">
        {ranked.slice(0, 5).map((row, index) => <button key={row.mask} type="button" className={`choice ${row.mask === other ? "selected" : ""}`} aria-pressed={row.mask === other} onClick={() => setOther(row.mask)}>
          <span className="choice-label">{index + 1}. {heldShort(row.mask)}</span>
          <span className="choice-hint">{gradeLabel(row.label, familyId)} · {row.ev.toFixed(3)} credits</span>
        </button>)}
        {!grade.correct && !ranked.slice(0, 5).some(row => row.mask === grade.chosenMask) && <button type="button" className={`choice ${grade.chosenMask === other ? "selected" : ""}`} aria-pressed={grade.chosenMask === other} onClick={() => setOther(grade.chosenMask)}>
          <span className="choice-label">Your hold · {heldShort(grade.chosenMask)}</span>
          <span className="choice-hint">{gradeLabel(grade.chosenLabel, familyId)} · {grade.chosenEv.toFixed(3)} credits</span>
        </button>}
      </div>
    </div>
  </section>;
}
