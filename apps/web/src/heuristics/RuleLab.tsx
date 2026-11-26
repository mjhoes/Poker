import { useEffect, useState } from "react";
import type { HeuristicScore } from "@perfect-draw/engine";
import type { Machine } from "@perfect-draw/shared";
import { Button } from "../components/ui";
import { errorMessage } from "../hooks/useActionRunner";
import type { Run } from "../hooks/useActionRunner";
import { formatCost } from "../ai/models";
import { heuristicsAi, parsePrompt } from "../ai/heuristics-ai";
import { heuristicService } from "../services/heuristics";
import { gradeLabel } from "../table/Feedback";
import { CostLine, ExampleHand } from "./HeuristicCardView";
import { draftToAst, MAX_CONDITIONS, RANKS, ruleWords } from "./rules";
import type { ConditionDraft, ConditionType, RuleDraft } from "./rules";
import { useCategories, useHeuristicsAi } from "./useHeuristics";

export const EMPTY_DRAFT: RuleDraft = { prefer: "", over: "", unless: [] };
const CONDITION_TYPES: { value: ConditionType; label: string }[] = [
  { value: "flush_penalty", label: "has a flush penalty" },
  { value: "straight_penalty", label: "has a straight penalty" },
  { value: "rank_held", label: "includes" },
  { value: "rank_discarded", label: "throws away" },
];

/**
 * The Rule Lab: "prefer [hold] over [hold] unless …" from lists, scored by the engine over every deal as you change it.
 * With an AI key, a rule typed in plain English fills in the same fields.
 */
export function RuleLab({ machine, familyId, draft, onDraft, busy, run }: { machine: Machine; familyId: string; draft: RuleDraft; onDraft: (draft: RuleDraft) => void; busy: boolean; run: Run }) {
  const categories = useCategories(machine.paytableId, machine.coins);
  const named = (categories?.codes ?? []).map(code => ({ code, name: gradeLabel(code, familyId) })).sort((a, b) => a.name.localeCompare(b.name));
  // Labels a card or the AI chose that aren't plain categories (a variant) still show in the pickers.
  const options = [...named, ...[draft.prefer, draft.over].filter(code => code && !named.some(item => item.code === code)).map(code => ({ code, name: gradeLabel(code, familyId) }))];
  const ready = !!draft.prefer && !!draft.over && draft.prefer !== draft.over && draft.unless.every(item => item.type.startsWith("rank") ? !!item.rank : true);
  const scoreKey = ready ? `${machine.paytableId}:${machine.coins}:${JSON.stringify(draft)}` : "";
  const [scored, setScored] = useState<{ key: string; score?: HeuristicScore; error?: string } | null>(null);
  useEffect(() => {
    if (!scoreKey) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setScored({ key: scoreKey });
      heuristicService.score(machine.paytableId, machine.coins, draftToAst(draft))
        .then(score => { if (!cancelled) setScored({ key: scoreKey, score }); }, reason => { if (!cancelled) setScored({ key: scoreKey, error: errorMessage(reason) }); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [scoreKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key names every input
  const shown = scored?.key === scoreKey ? scored : null;
  const words = ready ? ruleWords(draftToAst(draft), familyId) : null;

  const ai = useHeuristicsAi();
  const [sentence, setSentence] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const fillIn = async () => {
    if (!ai.provider) return;
    setParsing(true); setParseError("");
    try { onDraft((await heuristicsAi.parse(sentence, named, { provider: ai.provider, tier: ai.tier })).draft); }
    catch (reason) { setParseError(errorMessage(reason)); }
    finally { setParsing(false); }
  };

  const setCondition = (index: number, change: Partial<ConditionDraft>) => onDraft({ ...draft, unless: draft.unless.map((item, at) => at === index ? { ...item, ...change } : item) });
  const holdSelect = (which: "prefer" | "over", label: string) => <label className="field lab-hold"><span className="field-label">{label}</span>
    <select aria-label={label} value={draft[which]} onChange={event => onDraft({ ...draft, [which]: event.target.value })}>
      <option value="">Choose a hold…</option>
      {options.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
    </select></label>;

  return <section className="panel panel-pad rule-lab" aria-labelledby="lab-title">
    <p className="eyebrow">RULE LAB</p><h2 id="lab-title">Write a rule, see its exact cost</h2>
    <p className="train-copy">A rule decides the deals where both holds are possible and one of them is the best play. The engine checks it against every deal on this table at {machine.coins} {machine.coins === 1 ? "coin" : "coins"}.</p>
    {ai.provider && <div className="lab-english">
      <label className="field"><span className="field-label">In plain English</span>
        <textarea aria-label="Rule in plain English" rows={2} maxLength={500} placeholder="e.g. Keep 4 to a flush over a low pair, unless the pair is 2s" value={sentence} onChange={event => setSentence(event.target.value)} /></label>
      <Button variant="secondary" size="sm" loading={parsing} loadingLabel="Reading your rule…" disabled={busy || !sentence.trim() || !named.length} onClick={() => void fillIn()}>
        Fill in with AI · about {formatCost(heuristicsAi.estimateParse(parsePrompt(sentence, named), ai.provider, ai.tier))}</Button>
      {parseError && <p className="explain-error" role="alert">{parseError}</p>}
    </div>}
    {categories?.error ? <p className="status-note" role="alert">Couldn't read this table's holds: {categories.error}</p>
      : !categories?.codes ? <p className="status-note" role="status">Loading this table's holds…</p> : <>
      <div className="lab-holds">{holdSelect("prefer", "Prefer")}{holdSelect("over", "Over")}</div>
      <fieldset className="lab-exceptions"><legend className="field-label">Unless (any of these, then hold the other one)</legend>
        {draft.unless.map((condition, index) => <div key={index} className="lab-condition" role="group" aria-label={`Exception ${index + 1}`}>
          <select aria-label="Which hold" value={condition.on} onChange={event => setCondition(index, { on: event.target.value as ConditionDraft["on"] })}>
            <option value="preferred">the preferred hold</option><option value="other">the other hold</option></select>
          <select aria-label="Condition" value={condition.type} onChange={event => setCondition(index, { type: event.target.value as ConditionType, rank: event.target.value.startsWith("rank") ? condition.rank ?? "A" : null })}>
            {CONDITION_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          {condition.type.startsWith("rank") && <select aria-label="Rank" value={condition.rank ?? ""} onChange={event => setCondition(index, { rank: event.target.value })}>
            {RANKS.map(rank => <option key={rank} value={rank}>{rank === "T" ? "a Ten" : `a${rank === "A" || rank === "8" ? "n" : ""} ${rank}`}</option>)}</select>}
          <Button variant="secondary" size="sm" onClick={() => onDraft({ ...draft, unless: draft.unless.filter((_, at) => at !== index) })}>Remove</Button>
        </div>)}
        {draft.unless.length < MAX_CONDITIONS && <Button variant="secondary" size="sm" onClick={() => onDraft({ ...draft, unless: [...draft.unless, { type: "flush_penalty", on: "preferred", rank: null }] })}>Add exception</Button>}
      </fieldset>
      {draft.prefer && draft.prefer === draft.over && <p className="status-note">Choose two different holds.</p>}
      {words && <div className="lab-result" aria-label="Rule Lab result" role="group">
        <p className="heuristic-rule">{words.rule}</p>
        {words.exceptions.length > 0 && <ul className="heuristic-exceptions">{words.exceptions.map((text, index) => <li key={index}>{text}</li>)}</ul>}
        {!shown || (!shown.score && !shown.error) ? <p className="status-note" role="status">Checking every deal…</p>
          : shown.error ? <p className="status-note" role="alert">{shown.error}</p>
          : shown.score && <>
            {shown.score.appliesFreq === 0 ? <p className="status-note">No deal has both holds with one of them the best play, so this rule never decides anything.</p>
              : <CostLine costPct={shown.score.costPct} costWithoutExceptionsPct={shown.score.costWithoutExceptionsPct} appliesFreq={shown.score.appliesFreq} rightFreq={shown.score.rightFreq} hasExceptions={draft.unless.length > 0} />}
            {shown.score.examples.length > 0 && <div className="heuristic-examples"><p className="field-label">Where it's right</p>{shown.score.examples.map((example, index) => <ExampleHand key={index} example={{ ...example, hand: [...example.hand] }} />)}</div>}
            {shown.score.counterexamples.length > 0 && <div className="heuristic-examples"><p className="field-label">Where it's wrong (costliest)</p>{shown.score.counterexamples.map((example, index) => <ExampleHand key={index} example={{ ...example, hand: [...example.hand] }} />)}</div>}
            <Button variant="gold" disabled={busy || shown.score.appliesFreq === 0} onClick={() => void run(() => heuristicService.saveFromLab(machine.id, draft), { success: "Saved to your cards." })}>Save as card</Button>
          </>}
      </div>}
    </>}
  </section>;
}
