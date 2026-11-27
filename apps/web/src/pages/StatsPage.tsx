import { useEffect, useMemo, useRef, useState } from "react";
import { describeLabel, localDayBounds } from "@perfect-draw/engine";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { useAllPaytables } from "../paytables/catalog";
import type { Machine, StatsQuery, StatsReportView } from "@perfect-draw/shared";
import { dollarsFor } from "../components/ui";
import { denominationLabel } from "../machines/machine-info";
import { TrendChart, WeaknessRankingChart } from "../components/StatisticsCharts";
import { localCount } from "../components/UiHelpers";
import { StatsContext } from "../components/StatsContext";
import { CoachReportPanel } from "../components/CoachReportPanel";
import { statsService } from "../services/statistics";

type TrendMetric = "accuracyPct" | "evLostPer1000" | "asDrilledReturnPct";
type ConfusionKey = "evLostTotal" | "n" | "errors" | "errorRate" | "avgEvLoss" | "bestLabel" | "chosenLabel";

const describe = (label: string, familyId: string) => {
  try { return describeLabel(label, familyId as Parameters<typeof describeLabel>[1]); }
  catch { return label; }
};
const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(3)}%`;
/** Credit amounts (per line at this bet), with dollars when the report covers a single known denomination. */
const creditsFormatter = (denominationCents: number | null) => (value: number | null | undefined, digits = 3) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const amount = value !== 0 && Math.abs(value) < 0.001 ? `${value.toExponential(2)} credits` : `${value.toFixed(digits)} credits`;
  return denominationCents ? `${amount} (${dollarsFor(value, denominationCents)})` : amount;
};
const count = localCount;
const dateEpoch = (value: string, end = false) => {
  if (!value) return undefined;
  const bounds = localDayBounds(value, Intl.DateTimeFormat().resolvedOptions().timeZone);
  return end ? bounds.until : bounds.since;
};
const FULL_DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
const fullDay = (value: number) => FULL_DAY.format(value);

function Metric({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) {
  return <div className={`stats-metric ${emphasis ? "is-emphasis" : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export function StatsPage({ machines, decisionCount, onTrainStarted, onGoMachines }: {
  machines: Machine[];
  decisionCount: number;
  onTrainStarted: () => void;
  onGoMachines: () => void;
}) {
  const [paytableId, setPaytableId] = useState(PAY_TABLE_LIBRARY[0]?.id ?? "");
  const [coinValue, setCoinValue] = useState(5);
  const [mode, setMode] = useState<StatsQuery["mode"]>("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [report, setReport] = useState<StatsReportView | null>(null);
  const [reportQuery, setReportQuery] = useState<StatsQuery | null>(null);
  const [denomination, setDenomination] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("accuracyPct");
  const [sortKey, setSortKey] = useState<ConfusionKey>("evLostTotal");
  const [showEquivalent, setShowEquivalent] = useState(false);
  const [sortDirection, setSortDirection] = useState<"ascending" | "descending">("descending");
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [trainingLabel, setTrainingLabel] = useState("");
  const [training, setTraining] = useState(false);
  const [trainingError, setTrainingError] = useState("");
  const requestId = useRef(0);
  const allTables = useAllPaytables();
  const selectedTable = allTables.find(table => table.id === paytableId);
  const matchedMachines = useMemo(
    () => machines.filter(machine => machine.paytableId === paytableId && machine.coins === coinValue),
    [machines, paytableId, coinValue],
  );
  const selectedMachine = matchedMachines.find(machine => machine.id === selectedMachineId) ?? matchedMachines[0];

  useEffect(() => {
    if (matchedMachines.length && !matchedMachines.some(machine => machine.id === selectedMachineId)) {
      setSelectedMachineId(matchedMachines[0].id);
    }
  }, [matchedMachines, selectedMachineId]);

  useEffect(() => {
    const thisRequest = ++requestId.current;
    let start: number | undefined, end: number | undefined;
    try { start = dateEpoch(since); end = dateEpoch(until, true); }
    catch (error) { setError(String(error)); setReport(null); setLoading(false); return; }
    if (start !== undefined && end !== undefined && start > end) {
      setError("The start date must be on or before the end date.");
      setReport(null);
      setLoading(false);
      return;
    }
    const query: StatsQuery = {
      paytableId,
      coins: coinValue as 1 | 2 | 3 | 4 | 5,
      mode: mode ?? "all",
      ...(denomination ? { denominationCents: Number(denomination) } : {}),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(start === undefined ? {} : { since: start }),
      ...(end === undefined ? {} : { until: end }),
    };
    setLoading(true);
    setError("");
    setReport(null);
    statsService.report(query).then(result => {
      if (requestId.current === thisRequest) { setReport(result); setReportQuery(query); }
    }).catch(reason => {
      if (requestId.current === thisRequest) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (requestId.current === thisRequest) setLoading(false);
    });
    return () => { requestId.current++; };
  }, [paytableId, coinValue, mode, since, until, denomination, decisionCount, refreshKey]);

  const confusionRows = useMemo(() => {
    if (!report) return [];
    return report.confusion.filter(row => showEquivalent || row.errors > 0).sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      const compare = typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : Number(left) - Number(right);
      return (sortDirection === "ascending" ? compare : -compare);
    });
  }, [report, sortKey, sortDirection, showEquivalent]);

  function sortBy(key: ConfusionKey) {
    if (sortKey === key) setSortDirection(current => current === "ascending" ? "descending" : "ascending");
    else {
      setSortKey(key);
      setSortDirection(key === "bestLabel" || key === "chosenLabel" ? "ascending" : "descending");
    }
  }
  async function train(label: string) {
    if (!selectedMachine) return;
    setTraining(true);
    setTrainingLabel(label);
    setTrainingError("");
    try {
      await statsService.train({ machineId: selectedMachine.id, label });
      onTrainStarted();
    } catch (reason) {
      setTrainingError(reason instanceof Error ? reason.message : String(reason));
      setTraining(false);
      setTrainingLabel("");
    }
  }
  const filterSummary = `${selectedTable?.name ?? "Selected paytable"} · ${coinValue} coin${coinValue === 1 ? "" : "s"} · ${mode === "all" ? "all modes" : mode === "drill" ? "Rapid Drill" : "Free Play"}`;
  const showNoDecisions = !!report && report.n === 0;
  const dollarDenomination = denomination ? Number(denomination)
    : report && report.denominations.length === 1 && report.undenominatedArchived === 0 ? report.denominations[0] : null;
  const coins = creditsFormatter(dollarDenomination);
  const denominationChoices = [...new Set([...(report?.denominations ?? []), ...(denomination ? [Number(denomination)] : [])])].sort((a, b) => a - b);

  return <div className="stats-page">
    <div className="page-heading stats-heading">
      <div><p className="eyebrow">ENGINE-RECORDED DECISIONS · LOCAL ONLY</p><h1>Decision ledger</h1></div>
      <div className="stats-heading-actions">
        <p className="heading-note">Mistakes have a price. Review it against the exact table and coin count you practiced.</p>
        <button className="btn secondary" type="button" onClick={() => setRefreshKey(value => value + 1)} disabled={loading}>Refresh report</button>
      </div>
    </div>

    <section className="panel stats-filters" aria-label="Report filters">
      <div className="stats-filter-top"><div><p className="eyebrow">REPORT SCOPE</p><h2>One game configuration at a time</h2></div><span className="stats-scope">{filterSummary}</span></div>
      <div className="stats-filter-grid">
        <label className="field"><span className="field-label">Saved paytable</span><select value={paytableId} onChange={event => { setPaytableId(event.target.value); setDenomination(""); }} aria-label="Saved paytable">
          <optgroup label="Built-in">{allTables.filter(table => table.source === "library").map(table => <option key={table.id} value={table.id}>{table.name}</option>)}</optgroup>
          {allTables.some(table => table.source !== "library") && <optgroup label="Your pay tables">{allTables.filter(table => table.source !== "library").map(table => <option key={table.id} value={table.id}>{table.name}</option>)}</optgroup>}
        </select></label>
        <label className="field"><span className="field-label">Coins per hand</span><select value={coinValue} onChange={event => setCoinValue(Number(event.target.value))} aria-label="Coins per hand">
          {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} coin{value === 1 ? "" : "s"}</option>)}
        </select></label>
        <label className="field"><span className="field-label">Mode</span><select value={mode} onChange={event => setMode(event.target.value as StatsQuery["mode"])} aria-label="Session mode">
          <option value="all">All modes</option><option value="free_play">Free Play</option><option value="drill">Rapid Drill</option>
        </select></label>
        <label className="field"><span className="field-label">Denomination</span><select value={denomination} onChange={event => setDenomination(event.target.value)} aria-label="Denomination">
          <option value="">All denominations</option>
          {denominationChoices.map(cents => <option key={cents} value={cents}>{denominationLabel(cents)}</option>)}
        </select></label>
        <label className="field"><span className="field-label">From (local)</span><input type="date" value={since} onChange={event => setSince(event.target.value)} /></label>
        <label className="field"><span className="field-label">Through (local)</span><input type="date" value={until} onChange={event => setUntil(event.target.value)} /></label>
      </div>
      {report && !dollarDenomination && report.n > 0 && <p className="stats-dollar-note">{report.denominations.length > 1
        ? "This report mixes denominations, so figures are shown in credits. Choose a denomination to see dollars."
        : "Some archived history predates denomination tracking, so figures are shown in credits. Choose a denomination to see dollars for newer play."}</p>}
      {report && denomination && report.undenominatedArchived > 0 && <p className="stats-dollar-note">{count(report.undenominatedArchived)} archived decisions have no recorded denomination and are left out of this view.</p>}
      <p className="stats-filter-foot">Reports never combine paytables or coin counts. Dates include complete local days ({Intl.DateTimeFormat().resolvedOptions().timeZone}), including DST. Archived daily buckets retain their saved local dates and timezone.</p>
    </section>

    {error && <div className="error-banner stats-error" role="alert"><strong>Statistics could not be loaded.</strong> {error}<button className="btn secondary small" type="button" onClick={() => setRefreshKey(value => value + 1)}>Retry report</button></div>}
    {loading && <div className="stats-loading" aria-label="Loading statistics"><div className="skeleton" /><div className="skeleton" /><p className="eyebrow">Reading local decision records…</p></div>}

    {!loading && !error && report && <>
      {showNoDecisions && <div className="stats-empty-callout">
        <div><p className="eyebrow">NO PRIMARY DECISIONS IN THIS SCOPE</p><h2>Start with a real hand.</h2><p>These numbers will fill from engine-graded decisions in the selected paytable, coin count, date range and mode. Corrections are excluded from the primary totals.</p></div>
        <button className="btn gold" type="button" onClick={onGoMachines}>Choose a machine to practice</button>
      </div>}

      <section className="stats-overview" aria-label="Overall decision statistics">
        <Metric emphasis label="Primary decisions" value={count(report.n)} note={`${count(report.errors)} mistakes · ${coins(report.evLostTotal)} EV lost, raw total`} />
        <Metric label="Accuracy" value={report.accuracyPct === null ? "—" : percent(report.accuracyPct)} note={`Unweighted actual decisions · n_eff ${report.weightedN.toFixed(1)} for recency estimates`} />
        <Metric label="EV lost / 1,000" value={report.evLostPer1000 === null ? "—" : coins(report.evLostPer1000)} note="Raw EV cost scaled by actual decisions" />
        <Metric label="Optimal return" value={percent(report.optimalReturnPct)} note="Engine reference · this exact paytable and coin count" />
      </section>

      <section className="stats-return-grid" aria-label="Return estimates">
        <div className="panel panel-pad stats-return-card">
          <p className="eyebrow">SAMPLED PLAY</p><h2>Optimal vs. as drilled</h2>
          <div className="return-compare"><div><span>Optimal reference</span><strong>{percent(report.optimalReturnPct)}</strong></div><div><span>As-drilled return</span><strong>{report.asDrilledReturnPct === null ? "No observations" : percent(report.asDrilledReturnPct)}</strong></div></div>
          <p className="settings-copy">As-drilled return subtracts the recency-weighted sampled decision cost, normalized to one line. Overall estimates use a 14-day half-life; accuracy and raw totals above remain unweighted.</p>
        </div>
        <div className="panel panel-pad stats-return-card">
          <p className="eyebrow">REAL-PLAY WEIGHTING</p><h2>Coverage before forecast</h2>
          {report.realPlayWeightedEstimatePct !== null && <p className="stats-estimate"><strong>Real-play weighted ESTIMATE: {percent(report.realPlayWeightedEstimatePct)}</strong><br />{(report.imputedFrequencyShare * 100).toFixed(4)}% of real-play frequency filled using pooled recency-weighted observed loss per decision. Available from {(report.estimateMinCoverage * 100).toFixed(0)}% observed coverage; not a confidence bound.</p>}
          <div className="coverage-line"><strong>{(report.frequencyCoverage * 100).toFixed(1)}%</strong><span>optimal-category frequency covered</span><b>{report.unseenCategories} unseen</b></div>
          <div className="coverage-track" role="progressbar" aria-label="Optimal-category frequency coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, report.frequencyCoverage * 100))}><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, report.frequencyCoverage))})` }} /></div>
          {report.realPlayWeightedReturnPct !== null
            ? <p className="stats-full-coverage"><strong>Complete category coverage:</strong> {percent(report.realPlayWeightedReturnPct)} real-play weighted return estimate.</p>
            : report.coveredReturnCeilingPct !== null
              ? <p className="stats-ceiling"><strong>≤ {percent(report.coveredReturnCeilingPct)}</strong> covered-return ceiling; incomplete coverage. This is an optimistic calculation using observed-category estimates, not a full-game forecast or confidence bound. Unseen category costs are unknown.</p>
              : <p className="settings-copy">No observed categories to weight yet. Unseen categories have unknown costs.</p>}
        </div>
      </section>

      {report.excludedCorrections > 0 || report.excludedIncompatible > 0 ? <p className="stats-exclusions">Excluded from primary totals: {report.excludedCorrections} corrected decisions · {report.excludedIncompatible} incompatible records.</p> : null}

      <section className="panel panel-pad stats-trend">
        <div className="panel-title stats-section-head"><div><p className="eyebrow">DAILY RECORD · UNWEIGHTED</p><h2>How decisions have moved</h2><p>Only days with recorded observations appear; no gaps are filled with invented values.</p></div>
          <label className="stats-chart-control">Measure<select value={trendMetric} onChange={event => setTrendMetric(event.target.value as TrendMetric)} aria-label="Trend measure">
            <option value="accuracyPct">Accuracy</option><option value="evLostPer1000">EV loss / 1,000</option><option value="asDrilledReturnPct">As-drilled return</option>
          </select></label>
        </div>
        {report.trend.length ? <>
          <TrendChart report={report} metric={trendMetric} />
          <details className="stats-data-details"><summary>View daily data table ({report.trend.length} days)</summary><div className="table-scroll"><table className="stats-table"><caption>Daily unweighted engine report · {filterSummary}</caption><thead><tr><th scope="col">Local day</th><th scope="col">Decisions</th><th scope="col">Errors</th><th scope="col">Accuracy</th><th scope="col">EV lost / 1,000</th><th scope="col">As-drilled return</th></tr></thead><tbody>{report.trend.map(row => <tr key={row.at}><th scope="row">{fullDay(row.at)}</th><td>{count(row.n)}</td><td>{count(row.errors)}</td><td>{percent(row.accuracyPct)}</td><td>{coins(row.evLostPer1000)}</td><td>{percent(row.asDrilledReturnPct)}</td></tr>)}</tbody></table></div></details>
        </> : <div className="stats-chart-empty">No daily trend points in this report scope yet.</div>}
      </section>

      <section className="panel panel-pad stats-weakness">
        <div className="panel-title stats-section-head"><div><p className="eyebrow">WHERE TO SPEND PRACTICE TIME</p><h2>Weakness by optimal category</h2><p>Sorted by the engine’s weakness score: estimated mistake cost per real hand, adjusted for recency-weighted confidence.</p></div><span className="stats-method-pill">ENGINE ORDER</span></div>
        <WeaknessRankingChart categories={report.categories} familyId={report.familyId} />
        <div className="stats-category-list">{report.categories.map((category, index) => {
          const unobserved = category.n === 0;
          return <article className={`stats-category ${unobserved ? "is-unseen" : ""}`} key={category.label}>
            <div className="stats-category-rank">{String(index + 1).padStart(2, "0")}</div>
            <div className="stats-category-main"><h3>{describe(category.label, report.familyId)}</h3><p>{unobserved ? "No observations · mistake cost unknown" : `${count(category.n)} decisions · ${count(category.errors)} observed mistakes · ${coins(category.evLostTotal)} raw EV lost`}</p>
              {unobserved ? <span className="stats-unknown-tag">UNSAMPLED · UNKNOWN COST</span> :
                <div className="stats-category-facts"><span>Posterior error estimate <b>{(category.errorRate * 100).toFixed(1)}%</b></span><span>Avg. loss / mistake <b>{coins(category.avgEvLoss)}</b></span><span>Real-play frequency <b>{(category.frequency * 100).toFixed(2)}%</b></span><span>Confidence factor <b>{(category.confidence * 100).toFixed(1)}%</b></span></div>}
            </div>
            <div className="stats-weakness-value"><span>Weakness / real hand</span><strong>{unobserved ? "Unknown" : coins(category.weakness)}</strong></div>
            <button className="btn secondary small stats-train-button" type="button" disabled={training || !selectedMachine} onClick={() => void train(category.label)}>{training && trainingLabel === category.label ? "Preparing…" : "Train this"}</button>
          </article>;
        })}</div>
        {matchedMachines.length ? <div className="stats-training-machine"><label className="field"><span className="field-label">Training machine · matching paytable and coins only</span><select value={selectedMachine?.id ?? ""} onChange={event => setSelectedMachineId(event.target.value)} aria-label="Training machine">{matchedMachines.map(machine => <option key={machine.id} value={machine.id}>{machine.name} · {machine.coins} coins</option>)}</select></label><p>Training opens a persistent, no-wager Rapid Drill targeted to the selected category.</p></div> : <div className="stats-no-machine"><p><strong>No matching live machine.</strong> Create or edit a machine with this exact paytable and coin count before training a category.</p><button className="text-button" type="button" onClick={onGoMachines}>Go to Machines</button></div>}
        {trainingError && <div className="error-banner" role="alert">{trainingError}<button className="text-button" type="button" onClick={() => setTrainingError("")}>Dismiss</button></div>}
      </section>

      <StatsContext context={report.context} />
      {reportQuery && <CoachReportPanel report={report} query={reportQuery} payTable={selectedTable?.name ?? "this pay table"} scopeSummary={`${filterSummary}${since || until ? ` · ${since || "the start"} to ${until || "today"}` : ""}${denomination ? ` · ${denominationLabel(Number(denomination))} only` : ""}`} />}

      <section className="panel panel-pad stats-confusion">
        <div className="panel-title"><div><p className="eyebrow">RECORDED HOLD PAIRS</p><h2>Confusion matrix</h2><p>Correct equivalent holds may have different labels and zero EV loss. A label mismatch alone is not an error.</p></div></div>
        <label><input type="checkbox" checked={showEquivalent} onChange={event => setShowEquivalent(event.target.checked)} /> Show zero-loss / equivalent holds</label>
        {confusionRows.length ? <div className="table-scroll"><table className="stats-table confusion-table">
          <caption>Best-label and chosen-label pairs · {filterSummary}</caption>
          <thead><tr>
            {([
              ["bestLabel", "Engine-optimal category"], ["chosenLabel", "Chosen hold"], ["n", "Decisions"], ["errors", "Errors"], ["evLostTotal", "Raw EV loss"], ["errorRate", "Posterior error"], ["avgEvLoss", "Avg. loss / mistake"],
            ] as [ConfusionKey, string][]).map(([key, title]) => <th scope="col" key={key} aria-sort={sortKey === key ? sortDirection : "none"}>
              <button type="button" onClick={() => sortBy(key)}>{title}{sortKey === key && <span aria-hidden="true"> {sortDirection === "ascending" ? "↑" : "↓"}</span>}</button>
            </th>)}
          </tr></thead>
          <tbody>{confusionRows.map(row => <tr key={`${row.bestLabel}\u0000${row.chosenLabel}`}>
            <th scope="row">{describe(row.bestLabel, report.familyId)}</th><td>{describe(row.chosenLabel, report.familyId)}{row.errors === 0 && <small> · Equivalent hold / zero loss</small>}</td><td>{count(row.n)}</td><td>{count(row.errors)}</td><td>{coins(row.evLostTotal)}</td><td>{(row.errorRate * 100).toFixed(1)}%</td><td>{coins(row.avgEvLoss)}</td>
          </tr>)}</tbody>
        </table></div> : <div className="stats-chart-empty">No mistake pairs in this scope. Enable the toggle to include zero-loss equivalent holds.</div>}
      </section>

      <details className="panel panel-pad stats-methodology">
        <summary>How to read these estimates</summary>
        <div className="stats-method-content">
          <p>Overall accuracy, decision count, errors, and total EV loss are unweighted primary decisions. Corrections are excluded and listed above. EV loss is engine-derived; this page only formats and sorts the supplied report.</p>
          <p>Recency-weighted measures use a {report.halfLifeDays}-day half-life. Category posterior error uses Beta(1,1); the confidence factor is effective sample size divided by effective sample size plus {report.confidencePrior}. Weakness is posterior error probability × average mistake loss × real-play category frequency × confidence factor.</p>
          <p>As-drilled return uses recency-weighted sampled cost normalized to one line. Real-play weighting uses canonical optimal-category frequencies with suit multiplicities. A covered-return ceiling is optimistic and incomplete, not a full-game forecast or statistical confidence bound. Costs for unseen categories remain unknown.</p>
          <p>Once observed categories cover at least {(report.estimateMinCoverage * 100).toFixed(0)}% of real-play frequency, the separately labeled ESTIMATE fills the remaining frequency with pooled recency-weighted loss per observed decision. Its filled share is shown beside the number. The complete-coverage field and covered-return ceiling keep their original meanings.</p>
        </div>
      </details>
    </>}
    <p className="footer-note">LOCAL ENGINE REPORT · NO ANALYTICS STORED OUTSIDE THIS DEVICE</p>
  </div>;
}
