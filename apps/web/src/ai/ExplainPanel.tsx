import { useEffect, useMemo, useRef, useState } from "react";
import type { AiExplanation, AiProvider, AiTier } from "@perfect-draw/shared";
import { Button, ChoiceChips } from "../components/ui";
import { errorMessage } from "../hooks/useActionRunner";
import { comparisonKey, explainFacts } from "./explain-facts";
import type { ExplainInput } from "./explain-facts";
import { explainService } from "./explain";
import { formatCost, modelFor, modelInfo, PROVIDERS, providerName, TIERS } from "./models";
import { aiService, useAiStore } from "./store";
import type { Hand } from "@perfect-draw/engine";
import { gradeLabel } from "../table/Feedback";
import { engineClient } from "../worker/client";
import { signal } from "../diagnostics";

/**
 * "Explain in plain English" for one hold comparison. Nothing is sent until the player presses Explain; each model size
 * shows an estimated cost first, and the explanation shows what it actually cost. Explanations are saved on the device.
 */
export function ExplainPanel({ input, paytableId }: { input: ExplainInput; paytableId: string }) {
  const settings = useAiStore(state => state.settings);
  const keys = useAiStore(state => state.keys);
  useEffect(() => { if (!settings) void aiService.load(); }, [settings]);
  const available = PROVIDERS.filter(item => keys[item.id]).map(item => item.id);
  const preferred: AiProvider | null = settings && keys[settings.coachProvider] ? settings.coachProvider : available[0] ?? null;
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [tier, setTier] = useState<AiTier | null>(null);
  const chosenProvider = provider && keys[provider] ? provider : preferred;
  const chosenTier = tier ?? settings?.coachTier ?? "heavy";

  const facts = useMemo(() => explainFacts(input), [input]);
  const key = comparisonKey({ hand: input.hand, paytableId, coins: input.coins, bestMask: input.best.mask, otherMask: input.other.mask });
  /*
   * What is on screen: this comparison with this model. Results are tagged with the view they were asked for and shown
   * only while it is still the one on screen: a reply that arrives after the player picked another hold or model is
   * saved (and appears when they come back) but never shown under a different comparison.
   */
  const view = `${key}|${chosenProvider ?? ""}|${chosenTier}`;
  const currentView = useRef(view);
  currentView.current = view;
  const [found, setFound] = useState<{ view: string; record: AiExplanation | null; freshCalls: number | null } | null>(null);
  const [failure, setFailure] = useState<{ view: string; message: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const saved = found?.view === view ? found.record : null;
  const freshCalls = found?.view === view ? found.freshCalls : null;
  const error = failure?.view === view ? failure.message : "";

  // Show the saved explanation for the chosen model, else the newest saved one from any model.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const exact = chosenProvider ? await explainService.saved(key, chosenProvider, chosenTier) : null;
      const record = exact ?? await explainService.latest(key);
      if (!cancelled) setFound(previous => previous?.view === view && previous.freshCalls !== null ? previous : { view, record, freshCalls: null });
    })();
    return () => { cancelled = true; };
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps -- view covers key, provider and tier

  if (!settings) return null;
  const result = saved && <div className="explain-result" aria-live="polite">
    <p className="explain-summary">{saved.explanation.summary}</p>
    <p>{saved.explanation.why}</p>
    <p><strong>How to remember:</strong> {saved.explanation.howToRemember}</p>
    {saved.explanation.commonMistake && <p><strong>Common mistake:</strong> {saved.explanation.commonMistake}</p>}
    <p className="explain-meta">Written by AI from the engine's numbers, which it was checked against · {modelInfo(saved.model)?.name ?? saved.model} ·
      {" "}{freshCalls === null ? "saved on this device, no new cost" : <>cost {formatCost(saved.estCost)} ({saved.inputTokens.toLocaleString("en-US")} tokens in, {saved.outputTokens.toLocaleString("en-US")} out{freshCalls > 1 ? `, ${freshCalls} calls` : ""})</>}</p>
  </div>;
  if (!chosenProvider) return <div className={`explain ${saved ? "" : "is-empty"}`} role="group" aria-label="Explain in plain English">
    {result}
    <p className="explain-invite"><strong>Explain in plain English.</strong> Add an Anthropic or OpenAI API key to have AI explain {saved ? "other comparisons" : "this comparison"} from the engine's numbers. You choose the model and see the cost first.</p>
    <a className="btn secondary small" href="#/settings?section=ai">Add an API key</a>
  </div>;

  /** Adds the Expert chart's line for this hand when charts are already available (never starts a 20 s build). */
  const withChartLine = async () => {
    if (input.coins !== 5) return facts;
    try {
      if (!await engineClient().hasStrategyCharts(paytableId)) return facts;
      const citation = await engineClient().strategyCitation(input.hand as unknown as Hand, paytableId, "Expert");
      if (citation.line === null || !citation.lineLabel) return facts;
      return explainFacts({ ...input, chart: { chart: "Expert", line: citation.line + 1, of: citation.lineCount, rule: gradeLabel(citation.lineLabel, citation.familyId), agreesWithBestHold: citation.mask === input.best.mask } });
    } catch { return facts; } // the explanation works without it
  };
  const explain = async () => {
    const asked = view;
    setPending(asked); setFailure(null);
    try {
      const { record, calls } = await explainService.explain({ key, facts: await withChartLine(), provider: chosenProvider, tier: chosenTier });
      if (currentView.current === asked) setFound({ view: asked, record, freshCalls: calls });
      else signal("explain:reply-dropped"); // saved, but the player has moved on
    } catch (reason) {
      if (currentView.current === asked) setFailure({ view: asked, message: errorMessage(reason) });
    } finally {
      setPending(current => current === asked ? null : current);
    }
  };
  const loading = pending === view;
  const model = modelFor(chosenProvider, chosenTier);
  return <div className="explain" aria-label="Explain in plain English" role="group">
    <div className="explain-head">
      <h4>Explain in plain English</h4>
      {available.length > 1 && <ChoiceChips label="AI provider" value={chosenProvider} onChange={(value: AiProvider) => setProvider(value)}
        choices={available.map(id => ({ value: id, label: PROVIDERS.find(item => item.id === id)!.name.replace(/ \(.*\)$/, "") }))} />}
    </div>
    <ChoiceChips label="Model size" value={chosenTier} onChange={(value: AiTier) => setTier(value)} className="explain-tiers"
      choices={TIERS.map(item => {
        const option = modelFor(chosenProvider, item.id);
        return { value: item.id, label: item.label, name: `${item.label}: ${option.name}`, hint: `${option.name} · about ${formatCost(explainService.estimate(facts, chosenProvider, item.id))}` };
      })} />

    {result}
    <Button variant="secondary" size={saved ? "sm" : "md"} loading={loading} loadingLabel={`Explaining with ${model.name}…`} onClick={() => void explain()}>
      {saved && modelInfo(saved.model)?.id === model.id ? "Regenerate" : `Explain with ${model.name}`} · about {formatCost(explainService.estimate(facts, chosenProvider, chosenTier))}</Button>
    {error && <p className="explain-error" role="alert">{error}</p>}
    <p className="ai-note">Sent to {providerName(chosenProvider)} with your key only when you press the button. Estimates assume a typical reply.</p>
  </div>;
}
