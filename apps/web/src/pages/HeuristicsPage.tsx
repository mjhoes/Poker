import { useState } from "react";
import type { Machine } from "@perfect-draw/shared";
import type { RuleAST } from "@perfect-draw/engine";
import { Button, ChoiceChips } from "../components/ui";
import type { Run } from "../hooks/useActionRunner";
import { aiService } from "../ai/store";
import { MNEMONIC_STYLES } from "../ai/heuristics-ai";
import type { MnemonicStyle } from "../ai/heuristics-ai";
import { findPaytable } from "../paytables/catalog";
import { heuristicService } from "../services/heuristics";
import type { HeuristicCard } from "../services/heuristics";
import { HeuristicCardView } from "../heuristics/HeuristicCardView";
import { EMPTY_DRAFT, RuleLab } from "../heuristics/RuleLab";
import { astToDraft } from "../heuristics/rules";
import type { RuleDraft } from "../heuristics/rules";
import { useHeuristicCards, useHeuristicsAi } from "../heuristics/useHeuristics";

/** Personal heuristic cards for a machine's table, and the Rule Lab (docs/17-HEURISTICS-PLAN.md). */
export function HeuristicsPage({ machines, busy, run }: { machines: Machine[]; busy: boolean; run: Run }) {
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const machine = machines.find(item => item.id === machineId) ?? machines[0];
  const data = useHeuristicCards();
  const ai = useHeuristicsAi();
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const [note, setNote] = useState("");
  const heading = <div className="page-heading"><div><p className="eyebrow">HEURISTICS</p><h1>Rules you can remember.</h1></div>
    <p className="heading-note">The engine turns your costliest mistakes into short rules and checks each one against every deal.</p></div>;
  if (!machine) return <>{heading}<div className="empty-state"><div className="empty-mark" aria-hidden="true">H</div><h2>Add a machine first</h2>
    <p>Heuristics are written for one pay table at one bet: your machine's.</p><a className="btn" href="#/">Go to machines</a></div></>;

  const table = findPaytable(machine.paytableId);
  const familyId = table?.familyId ?? "jacks_or_better";
  const mine = (data?.cards ?? []).filter(card => card.paytableId === machine.paytableId && card.coins === machine.coins)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const active = mine.filter(card => card.status !== "archived" && !data?.mastered.has(card.id));
  const mastered = mine.filter(card => card.status !== "archived" && data?.mastered.has(card.id));
  const archived = mine.filter(card => card.status === "archived");
  const make = () => run(async () => {
    const result = await heuristicService.fromMistakes(machine.id);
    setNote(!result.targets ? "No costly mistakes on this table yet. Play some hands, then make cards from them."
      : `${result.made.length} ${result.made.length === 1 ? "card" : "cards"} from your ${result.targets} costliest ${result.targets === 1 ? "mistake" : "mistakes"}${result.skipped ? ` (${result.skipped} about which cards to keep can't be a rule between two holds)` : ""}.`);
  });
  const openInLab = (card: HeuristicCard) => {
    const loaded = astToDraft(card.ruleAst as unknown as RuleAST);
    if (loaded) { setDraft(loaded); document.getElementById("lab-title")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  const view = (card: HeuristicCard) => <HeuristicCardView key={card.id} card={card} mastered={!!data?.mastered.has(card.id)} busy={busy} ai={ai} onOpenInLab={openInLab} run={run} />;

  return <>
    {heading}
    <div className="train-bar">
      <label className="field train-machine"><span className="field-label">Machine</span>
        <select aria-label="Heuristics machine" value={machine.id} onChange={event => { setMachineId(event.target.value); setDraft(EMPTY_DRAFT); setNote(""); }}>
          {machines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      <p className="muted">{table?.name ?? machine.name} · {machine.coins} {machine.coins === 1 ? "coin" : "coins"}</p>
    </div>

    <section className="panel panel-pad heuristics-intro" aria-labelledby="cards-title">
      <div className="panel-title"><div><p className="eyebrow">YOUR CARDS</p><h2 id="cards-title">From your costliest mistakes</h2>
        <p>Each card says which hold to prefer, the exceptions the engine found, a few example deals, and what following it costs.</p></div></div>
      <div className="train-actions">
        <Button variant="gold" icon="play" disabled={busy} onClick={() => void make()}>Make cards from my mistakes</Button>
        {ai.provider && <ChoiceChips label="Mnemonic style" value={ai.style} onChange={(value: MnemonicStyle) => void run(() => aiService.updateSettings({ mnemonicStyle: value }))}
          choices={MNEMONIC_STYLES.map(item => ({ value: item.id, label: item.label, hint: item.hint }))} />}
      </div>
      {note && <p className="status-note" role="status">{note}</p>}
      {!data ? <p className="status-note">Loading…</p> : !mine.length && <p className="status-note">No cards for this table yet.</p>}
    </section>
    <div className="heuristic-grid">{active.map(view)}</div>
    {mastered.length > 0 && <details className="heuristic-group" open><summary>Mastered ({mastered.length})</summary><div className="heuristic-grid">{mastered.map(view)}</div></details>}
    {archived.length > 0 && <details className="heuristic-group"><summary>Archived ({archived.length})</summary><div className="heuristic-grid">{archived.map(view)}</div></details>}

    <RuleLab machine={machine} familyId={familyId} draft={draft} onDraft={setDraft} busy={busy} run={run} />
  </>;
}
