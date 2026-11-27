import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import type { AiProvider, StatsQuery, StatsReportView } from "@perfect-draw/shared";
import { Button } from "./ui";
import { dateTime } from "./UiHelpers";
import { errorMessage } from "../hooks/useActionRunner";
import { useAiStore } from "../ai/store";
import { coachFacts, coachScope, coachService } from "../ai/coach";
import type { CoachReport } from "../ai/coach";
import { formatCost, modelFor, modelInfo } from "../ai/models";

/** The coach's provider and size: the chosen coach provider when its key is set, else the other. */
function useCoachAi() {
  const settings = useAiStore(state => state.settings);
  const keys = useAiStore(state => state.keys);
  const available = (["anthropic", "openai"] as AiProvider[]).filter(provider => !!keys[provider]);
  const preferred = settings?.coachProvider ?? "anthropic";
  return { provider: available.includes(preferred) ? preferred : available[0] ?? null, tier: settings?.coachTier ?? "heavy" };
}

function useSavedReports(paytableId: string, coins: number) {
  const [reports, setReports] = useState<CoachReport[] | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => coachService.list(paytableId, coins)).subscribe({ next: setReports, error: () => setReports([]) });
    return () => subscription.unsubscribe();
  }, [paytableId, coins]);
  return reports;
}

function ReportBody({ report }: { report: CoachReport }) {
  const list = (title: string, items: string[]) => items.length > 0 && <div className="coach-list"><h4>{title}</h4><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>;
  return <>
    <p className="coach-headline">{report.report.headline}</p>
    {list("Going well", report.report.wins)}
    {list("Focus on", report.report.focus)}
    {list("Plan", report.report.plan)}
    <p className="ai-note">{dateTime(report.createdAt)} · {report.scope.summary} · written by {modelInfo(report.model)?.name ?? report.model} from these statistics only, every number checked · cost {formatCost(report.estCost)}</p>
  </>;
}

/**
 * The AI coach report (docs/19-CONTEXT-ANALYSIS-PLAN.md): written on demand from this scope's statistics, with the cost
 * shown first, and saved to reread.
 */
export function CoachReportPanel({ report, query, payTable, scopeSummary }: { report: StatsReportView; query: StatsQuery; payTable: string; scopeSummary: string }) {
  const ai = useCoachAi();
  const saved = useSavedReports(query.paytableId, query.coins ?? 5);
  const [writing, setWriting] = useState(false);
  const [failure, setFailure] = useState("");
  const facts = coachFacts(report, { payTable, summary: scopeSummary });
  const write = async () => {
    if (!ai.provider) return;
    setWriting(true); setFailure("");
    try { await coachService.write({ scope: coachScope(query, scopeSummary), facts, provider: ai.provider, tier: ai.tier }); }
    catch (reason) { setFailure(errorMessage(reason)); }
    finally { setWriting(false); }
  };
  const [latest, ...older] = saved ?? [];
  return <section className="panel panel-pad stats-coach" aria-labelledby="coach-title">
    <div className="panel-title stats-section-head"><div><p className="eyebrow">AI COACH</p><h2 id="coach-title">Your coach report</h2>
      <p>A short report written from this page's statistics only: what's going well, what costs most, and what to practice next. Every number is checked against the statistics.</p></div></div>
    <div className="train-actions">
      {ai.provider
        ? <Button variant="gold" icon="sparkle" loading={writing} loadingLabel={`Writing with ${modelFor(ai.provider, ai.tier).name}…`} disabled={!report.n} onClick={() => void write()}>
          Write my coach report · about {formatCost(coachService.estimate(facts, ai.provider, ai.tier))}</Button>
        : <a className="btn secondary" href="#/settings?section=ai">Add an AI key to get a coach report</a>}
      {!report.n && <span className="muted">Play some hands in this scope first.</span>}
    </div>
    {failure && <p className="explain-error" role="alert">{failure}</p>}
    {latest && <article className="coach-report" aria-label="Latest coach report"><ReportBody report={latest} />
      <Button variant="secondary" size="sm" onClick={() => void coachService.remove(latest.id)}>Delete</Button></article>}
    {older.length > 0 && <details className="coach-older"><summary>Earlier reports ({older.length})</summary>
      {older.map(item => <article key={item.id} className="coach-report"><ReportBody report={item} />
        <Button variant="secondary" size="sm" onClick={() => void coachService.remove(item.id)}>Delete</Button></article>)}
    </details>}
  </section>;
}
