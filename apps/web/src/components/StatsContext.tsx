import type { ContextFinding, ContextReport } from "@perfect-draw/shared";

/*
 * "When your mistakes happen" (docs/19-CONTEXT-ANALYSIS-PLAN.md): each situation against what its hands would explain
 * at the player's own mistake rate on each hand type. Only differences clear of chance are called out.
 */
const per100 = (value: number) => value.toFixed(1);
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${per100(Math.abs(value))}`;

/** A finding in words: "Under 2 seconds: 6.2 more mistakes per 100 hands than these hands explain (±3.1, 312 hands)." */
export function findingText(finding: ContextFinding) {
  const situation = finding.factor === "previous_draw" || finding.factor === "previous_hand" || finding.factor === "table_change"
    ? finding.bucketLabel : `${finding.factorTitle}, ${finding.bucketLabel.toLowerCase()}`;
  return `${situation}: ${per100(Math.abs(finding.excessPer100))} ${finding.worse ? "more" : "fewer"} mistakes per 100 hands than these hands explain (±${per100(finding.ciPer100)}, ${finding.n.toLocaleString()} hands).`;
}

export function StatsContext({ context }: { context: ContextReport }) {
  const enough = context.n >= context.minHands;
  return <section className="panel panel-pad stats-context" aria-labelledby="context-title">
    <div className="panel-title stats-section-head"><div><p className="eyebrow">CONTEXT</p><h2 id="context-title">When your mistakes happen</h2>
      <p>Each situation is compared with what its hands would explain at your own mistake rate on each hand type, so harder hands don't make a situation look worse. Only differences clear of chance (95%) are called out.</p></div>
      <span className="stats-method-pill">DIFFICULTY-ADJUSTED</span></div>
    {!enough ? <p className="status-note">Context needs at least {context.minHands} recent first answers in this scope ({context.n} so far).</p> : <>
      <div className="context-findings" role="group" aria-label="Context findings">
        {context.findings.length ? <ul>{context.findings.map(finding =>
          <li key={`${finding.factor}-${finding.bucket}`} className={finding.worse ? "is-worse" : "is-better"}>{findingText(finding)}</li>)}</ul>
          : <p>Nothing stands out: in every situation, your mistakes are within what the hands explain.</p>}
      </div>
      <details className="context-details">
        <summary>Every situation</summary>
        {context.factors.map(factor => <div key={factor.id} className="context-factor">
          <h3>{factor.title}</h3><p className="muted">{factor.note}</p>
          <table className="context-table" aria-label={factor.title}>
            <thead><tr><th scope="col">Situation</th><th scope="col">Hands</th><th scope="col">Mistakes / 100</th><th scope="col">Expected / 100</th><th scope="col">Difference</th><th scope="col">EV lost / 100</th></tr></thead>
            <tbody>{factor.buckets.map(bucket => <tr key={bucket.id} className={bucket.counts ? bucket.excessPer100 > 0 ? "is-worse" : "is-better" : ""}>
              <th scope="row">{bucket.label}</th>
              <td>{bucket.n.toLocaleString()}</td>
              <td>{bucket.n ? per100(bucket.ratePct) : "—"}</td>
              <td>{bucket.n ? per100(bucket.expectedRatePct) : "—"}</td>
              <td>{bucket.n ? <>{signed(bucket.excessPer100)} <span className="muted">±{per100(bucket.ciPer100)}</span>{bucket.counts && <b> · clear</b>}</> : "—"}</td>
              <td>{bucket.n ? <>{bucket.lossPer100.toFixed(2)} <span className="muted">(usual {bucket.expectedLossPer100.toFixed(2)})</span></> : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>)}
      </details>
    </>}
    <p className="context-note muted">Each situation is checked on its own, so two that tend to happen together (say, quick decisions that also follow right answers) can both show. From your first answers in the last 90 days: older days are kept only as daily totals, without each hand's context. EV in credits.</p>
  </section>;
}
