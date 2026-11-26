import { useState } from "react";
import type { AiProvider, AiTier } from "@perfect-draw/shared";
import { Badge, Button } from "../components/ui";
import { familyName } from "../components/UiHelpers";
import { errorMessage } from "../hooks/useActionRunner";
import { formatCost, modelFor, modelInfo } from "../ai/models";
import { heuristicsAi, polishFacts } from "../ai/heuristics-ai";
import type { RuleAST } from "@perfect-draw/engine";
import { ruleWords } from "./rules";
import type { MnemonicStyle } from "../ai/heuristics-ai";
import { findPaytable } from "../paytables/catalog";
import type { HeuristicCard } from "../services/heuristics";
import { heuristicService } from "../services/heuristics";
import { CardFace } from "../table/CardFace";
import { maskIndexes, shortCard } from "../table/cards";

type Example = HeuristicCard["examples"][number];
export const percent = (value: number) => value > 0 && value < 0.001 ? "under 0.001%" : `${value.toFixed(3)}%`;
const heldText = (hand: readonly number[], mask: number) => maskIndexes(mask).map(index => shortCard(hand[index])).join(" ") || "nothing (draw five)";

/** One deal: the five cards with the card's hold raised, and what the best play is when the card is wrong. */
export function ExampleHand({ example }: { example: Example }) {
  const text = `${example.hand.map(shortCard).join(" ")}: hold ${heldText(example.hand, example.mask)}`;
  return <div className={`heuristic-example ${example.evLoss > 0 ? "is-wrong" : ""}`}>
    <span className="hold-cards" role="img" aria-label={text}>{example.hand.map((card, index) =>
      <span key={`${card}-${index}`} className={`mini-card ${(example.mask & (1 << index)) ? "is-held" : "is-dropped"}`}><CardFace card={card} variant="compact" /></span>)}</span>
    <span className="heuristic-example-text">
      <strong>{example.exception ? "Exception" : "Rule"}: hold {heldText(example.hand, example.mask)}</strong>
      {example.evLoss > 0 && <span>Best: {heldText(example.hand, example.bestMask)} · gives up {example.evLoss.toFixed(3)} credits</span>}
    </span>
  </div>;
}

/** The engine's figures for a card or a Rule Lab rule. */
export function CostLine({ costPct, costWithoutExceptionsPct, appliesFreq, rightFreq, hasExceptions }: { costPct: number; costWithoutExceptionsPct: number; appliesFreq: number; rightFreq: number; hasExceptions: boolean }) {
  return <p className="heuristic-cost">
    <span><strong>{percent(costPct)}</strong> of return if you follow it{hasExceptions ? <> ({percent(costWithoutExceptionsPct)} without the exceptions)</> : null}</span>
    <span>Decides {(appliesFreq * 1000).toFixed(1)} of every 1,000 deals · right on {(rightFreq * 100).toFixed(1)}% of them</span>
  </p>;
}

export function HeuristicCardView({ card, mastery, busy, ai, onOpenInLab, run }: {
  card: HeuristicCard; mastery: "mastered" | "hidden" | null; busy: boolean; ai: { provider: AiProvider | null; tier: AiTier; style: MnemonicStyle };
  onOpenInLab: (card: HeuristicCard) => void; run: (action: () => Promise<unknown>, options?: { success?: string }) => Promise<boolean>;
}) {
  const [polishing, setPolishing] = useState(false);
  const [failure, setFailure] = useState("");
  const table = findPaytable(card.paytableId);
  const familyId = table?.familyId ?? "jacks_or_better";
  const facts = polishFacts(card, { familyId, game: familyName(familyId), payTable: table?.name ?? "this pay table", style: ai.style });
  const polish = async () => {
    if (!ai.provider) return;
    setPolishing(true); setFailure("");
    try { await heuristicsAi.polish(card, facts, { provider: ai.provider, tier: ai.tier, style: ai.style }); }
    catch (reason) { setFailure(errorMessage(reason)); }
    finally { setPolishing(false); }
  };
  const archived = card.status === "archived";
  const exact = Object.values(ruleWords(card.ruleAst as unknown as RuleAST, familyId)).flat();
  return <article className={`panel panel-pad heuristic-card ${archived ? "is-archived" : ""}`} aria-label={`Heuristic: ${card.ruleText}`}>
    <p className="eyebrow">{card.source === "lab" ? "FROM THE RULE LAB" : "FROM YOUR MISTAKES"}{mastery === "mastered" && <> <Badge tone="success">Mastered</Badge></>}</p>
    <h3 className="heuristic-rule">{card.ruleText}</h3>
    {card.exceptions.length > 0 && <ul className="heuristic-exceptions" aria-label="Exceptions">{card.exceptions.map((text, index) => <li key={index}>{text}</li>)}</ul>}
    {card.mnemonic && <p className="heuristic-mnemonic">“{card.mnemonic}”</p>}
    {/* The engine's own words stay in view under AI wording: they're the rule the costs describe. */}
    {card.aiModel && <p className="heuristic-exact" aria-label="The engine's rule"><span className="field-label">The engine's rule</span> {exact.join(" ")}</p>}
    {mastery === "hidden" && <p className="status-note">Mastery shows after your quiet session closes.</p>}
    <CostLine costPct={card.costPct} costWithoutExceptionsPct={card.costWithoutExceptionsPct} appliesFreq={card.appliesFreq} rightFreq={card.rightFreq} hasExceptions={card.exceptions.length > 0} />
    {card.examples.length > 0 && <div className="heuristic-examples" aria-label="Examples"><p className="field-label">Examples</p>{card.examples.map((example, index) => <ExampleHand key={index} example={example} />)}</div>}
    {card.counterexamples.length > 0 && <details className="heuristic-wrong"><summary>Where it's wrong ({card.counterexamples.length} costliest)</summary>
      {card.counterexamples.map((example, index) => <ExampleHand key={index} example={example} />)}</details>}
    <div className="train-actions">
      {ai.provider ? <Button variant="secondary" size="sm" loading={polishing} loadingLabel={`Writing with ${modelFor(ai.provider, ai.tier).name}…`} disabled={busy || archived} onClick={() => void polish()}>
        {card.aiModel ? "Polish again" : "Polish with AI"} · about {formatCost(heuristicsAi.estimatePolish(facts, ai.provider, ai.tier))}</Button>
        : <a className="btn secondary small" href="#/settings?section=ai">Add an AI key to polish</a>}
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => onOpenInLab(card)}>Open in Rule Lab</Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => heuristicService.setStatus(card.id, archived ? "active" : "archived"))}>{archived ? "Restore" : "Archive"}</Button>
    </div>
    {failure && <p className="explain-error" role="alert">{failure}</p>}
    {card.aiModel && <p className="ai-note">Words by {modelInfo(card.aiModel)?.name ?? card.aiModel}, read back into a rule and checked against the engine's rule and numbers. The rule and its costs are the engine's.</p>}
  </article>;
}
