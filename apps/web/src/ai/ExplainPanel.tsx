import { useEffect, useMemo, useState } from "react";
import type { AiExplanation, AiProvider, AiTier } from "@perfect-draw/shared";
import { Button, ChoiceChips } from "../components/ui";
import { errorMessage } from "../hooks/useActionRunner";
import { comparisonKey, explainFacts } from "./explain-facts";
import type { ExplainInput } from "./explain-facts";
import { explainService } from "./explain";
import { formatCost, modelFor, modelInfo, PROVIDERS, providerName, TIERS } from "./models";
import { aiService, useAiStore } from "./store";

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
  const [saved, setSaved] = useState<AiExplanation | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [freshCalls, setFreshCalls] = useState<number | null>(null);

  // Show the saved explanation for the chosen model, else the newest saved one from any model.
  useEffect(() => {
    let cancelled = false;
    setStatus("idle"); setError(""); setFreshCalls(null);
    void (async () => {
      const exact = chosenProvider ? await explainService.saved(key, chosenProvider, chosenTier) : null;
      const record = exact ?? await explainService.latest(key);
      if (!cancelled) setSaved(record);
    })();
    return () => { cancelled = true; };
  }, [key, chosenProvider, chosenTier]);

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

  const explain = async () => {
    setStatus("loading"); setError("");
    try {
      const { record, calls } = await explainService.explain({ key, facts, provider: chosenProvider, tier: chosenTier });
      setSaved(record); setFreshCalls(calls); setStatus("idle");
    } catch (failure) { setError(errorMessage(failure)); setStatus("error"); }
  };
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
    <Button variant="secondary" size={saved ? "sm" : "md"} loading={status === "loading"} loadingLabel={`Explaining with ${model.name}…`} onClick={() => void explain()}>
      {saved?.model === model.id ? "Regenerate" : `Explain with ${model.name}`} · about {formatCost(explainService.estimate(facts, chosenProvider, chosenTier))}</Button>
    {status === "error" && <p className="explain-error" role="alert">{error}</p>}
    <p className="ai-note">Sent to {providerName(chosenProvider)} with your key only when you press the button. Estimates assume a typical reply.</p>
  </div>;
}
