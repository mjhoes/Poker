import { useEffect, useMemo, useState } from "react";
import type { Machine } from "@perfect-draw/shared";
import { Badge } from "../components/ui";
import { money } from "../components/UiHelpers";
import { denominationLabel } from "../machines/machine-info";
import type { PaytableInfo } from "../paytables/catalog";
import { engineClient } from "../worker/client";
import type { RiskBand } from "../worker/risk";
import { errorMessage } from "../hooks/useActionRunner";
import { costPerPointCents, plan } from "./economics";
import type { Program, ReturnInfo } from "./economics";
import { returnKey, useExpectedReturns } from "./useCruise";

const DENOMINATIONS = [1, 5, 10, 25, 50, 100, 200, 500, 1000, 2500];
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${money(Math.abs(cents))}`;
const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const hoursText = (hours: number) => !Number.isFinite(hours) ? "—" : hours < 10 ? `${number(hours, 1)} h` : `${number(hours)} h`;

export type PlannerDefaults = {
  targetPoints: number; pointsSoFar: number; hoursLeft: number; handsPerHour: number;
  paceSource: "casino" | "practice" | "default"; paytableId?: string; denominationCents: number; coins: number;
  /** Your fastest Free Play pace that keeps the accuracy bar (Casino-Pace Mode), if there is one. */
  bestPace?: number | null; accuracyPct?: number;
};

type Overrides = Partial<Record<"target" | "soFar" | "hours" | "pace" | "paytableId" | "denomination" | "coins", string>>;

/** Why the return in use doesn't count your mistakes, or how far it's estimated. */
export function returnBasisNote(expected: ReturnInfo) {
  if (expected.basis === "measured") return `with your measured mistakes (perfect play ${number(expected.optimalPct, 2)}%)`;
  if (expected.basis === "estimated") {
    return `with your mistakes, estimated: ${number((expected.imputedShare ?? 0) * 100, 1)}% of deals are kinds you haven't practiced yet (perfect play ${number(expected.optimalPct, 2)}%)`;
  }
  return expected.reason === "low-coverage"
    ? `at perfect play: your practice on this game covers ${number((expected.coverage ?? 0) * 100, 1)}% of deals, too little to count your mistakes for real play`
    : "at perfect play: fewer than 200 practice decisions on this game at this bet, so your mistakes aren't counted yet";
}

/**
 * The trip planner (07-CRUISE-REWARDS.md §4): what reaching the target takes at a game, bet and pace, and the range
 * of results luck could bring. Each input shows the trip's current figure (points, hours left, pace and game follow the
 * trip as it changes) until you change it to ask "what if"; changed inputs stay as you set them until you reset.
 */
export function Planner({ program, defaults, tables, machines }: { program: Program; defaults: PlannerDefaults; tables: PaytableInfo[]; machines: Machine[] }) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const set = (field: keyof Overrides) => (value: string) => setOverrides(previous => ({ ...previous, [field]: value }));
  const target = overrides.target ?? String(defaults.targetPoints);
  const soFar = overrides.soFar ?? String(Math.floor(defaults.pointsSoFar));
  const hours = overrides.hours ?? defaults.hoursLeft.toFixed(1);
  const pace = overrides.pace ?? String(Math.round(defaults.handsPerHour));
  const paytableId = overrides.paytableId ?? defaults.paytableId ?? machines[0]?.paytableId ?? tables[0]?.id ?? "";
  const denomination = Number(overrides.denomination ?? defaults.denominationCents);
  const coins = Number(overrides.coins ?? defaults.coins);
  const changed = Object.keys(overrides).length > 0;
  const [band, setBand] = useState<{ key: string; value?: RiskBand; error?: string } | null>(null);

  const returns = useExpectedReturns(useMemo(() => [{ paytableId, coins }], [paytableId, coins]));
  const expected = returns.get(returnKey(paytableId, coins));
  const bet = denomination * coins;
  const inputs = { targetPoints: Number(target.replace(/,/g, "")), pointsSoFar: Number(soFar.replace(/,/g, "")), hoursLeft: Number(hours), handsPerHour: Number(pace) };
  const valid = Object.values(inputs).every(value => Number.isFinite(value) && value >= 0) && inputs.handsPerHour > 0;
  const result = valid && expected ? plan({ ...inputs, dollarsPerPoint: program.dollarsPerPoint, betCents: bet, effectiveReturnPct: expected.effectivePct }) : null;
  const hands = result ? Math.round(result.handsNeeded) : 0;
  const mistakePct = expected ? expected.optimalPct - expected.effectivePct : 0;
  const bandKey = `${paytableId}:${coins}:${bet}:${hands}:${mistakePct.toFixed(6)}`;

  useEffect(() => {
    if (!result || !expected || hands <= 0 || hands > 50_000_000) { setBand(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBand(previous => previous?.key === bandKey ? previous : { key: bandKey });
      engineClient().riskBand({ paytableId, coins, betCents: bet, hands, mistakePct })
        .then(value => { if (!cancelled) setBand({ key: bandKey, value }); },
          reason => { if (!cancelled) setBand({ key: bandKey, error: errorMessage(reason) }); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [bandKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key covers every input

  const paceNote = defaults.paceSource === "casino" ? "Your casino pace" : defaults.paceSource === "practice" ? "Your Free Play pace" : "A typical pace";
  const current = band?.key === bandKey ? band : null;
  return <section className="panel panel-pad planner cruise-panel" aria-labelledby="planner-title">
    <div className="panel-title"><div><p className="eyebrow">PLANNER</p><h2 id="planner-title">What the target takes</h2>
      <p>Change anything to ask "what if". Denomination changes the time and the swings, not the cost per point.</p></div>
      {result && <Badge tone={result.onTrack ? "success" : "warning"} dot>{result.pointsNeeded === 0 ? "Target reached" : result.onTrack ? "On track" : "Behind"}</Badge>}
    </div>
    <div className="planner-inputs">
      <label className="field"><span className="field-label">Target points</span><input aria-label="Planner target points" inputMode="numeric" value={target} onChange={event => set("target")(event.target.value)} /></label>
      <label className="field"><span className="field-label">Points so far</span><input aria-label="Planner points so far" inputMode="numeric" value={soFar} onChange={event => set("soFar")(event.target.value)} /></label>
      <label className="field"><span className="field-label">Casino hours left</span><input aria-label="Casino hours left" inputMode="decimal" value={hours} onChange={event => set("hours")(event.target.value)} /></label>
      <label className="field"><span className="field-label">Hands per hour</span><input aria-label="Hands per hour" inputMode="numeric" value={pace} onChange={event => set("pace")(event.target.value)} />{overrides.pace === undefined && <small className="field-note">{paceNote}</small>}
        {defaults.bestPace && Math.round(defaults.bestPace) !== Number(pace) && <button type="button" className="link-button field-note-action" onClick={() => set("pace")(String(Math.round(defaults.bestPace!)))}>
          Use your best accurate pace: {number(defaults.bestPace)}</button>}</label>
      <label className="field wide"><span className="field-label">Game</span><select aria-label="Planner game" value={paytableId} onChange={event => set("paytableId")(event.target.value)}>
        {tables.map(table => <option key={table.id} value={table.id}>{table.name}</option>)}
      </select></label>
      <label className="field"><span className="field-label">Denomination</span><select aria-label="Planner denomination" value={denomination} onChange={event => set("denomination")(event.target.value)}>
        {[...new Set([...DENOMINATIONS, denomination])].sort((a, b) => a - b).map(cents => <option key={cents} value={cents}>{denominationLabel(cents)}</option>)}
      </select></label>
      <label className="field"><span className="field-label">Coins</span><select aria-label="Planner coins" value={coins} onChange={event => set("coins")(event.target.value)}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    {changed && <p className="planner-reset"><button type="button" className="link-button" onClick={() => setOverrides({})}>Back to the trip's figures</button></p>}
    {!valid && <p className="status-note" role="alert">Enter non-negative numbers, and a pace above zero.</p>}
    {valid && !expected && <p className="status-note">Working out this game's return…</p>}
    {result && expected && <>
      <p className="planner-return">
        Return {number(expected.effectivePct, 2)}% <span className={expected.basis === "measured" ? undefined : "muted"}>{returnBasisNote(expected)}</span>.
        A point costs <strong>{money(costPerPointCents(program, expected.effectivePct))}</strong> in theory at {money(bet)} a hand.
      </p>
      <div className="planner-grid">
        <dl className="planner-list">
          <div className="metric-row"><dt>Points to go</dt><dd><strong>{number(result.pointsNeeded)}</strong></dd></div>
          <div className="metric-row"><dt>Coin-in needed</dt><dd><strong>{money(result.coinInNeededCents)}</strong></dd></div>
          <div className="metric-row"><dt>Hands at {money(bet)}</dt><dd><strong>{number(result.handsNeeded)}</strong></dd></div>
          <div className="metric-row"><dt>Hours at {number(inputs.handsPerHour)} hands/hr</dt><dd><strong>{hoursText(result.hoursNeeded)}</strong></dd></div>
          <div className="metric-row"><dt>Points per hour</dt><dd><strong>{number(result.pointsPerHour, 1)}</strong></dd></div>
          <div className="metric-row"><dt>Expected cost</dt><dd><strong>{money(result.expectedCostCents)}</strong></dd></div>
        </dl>
        <div className="planner-verdict">
          {result.pointsNeeded === 0 ? <p>You've reached the target.</p>
            : inputs.hoursLeft <= 0 ? <p>No casino hours left on this trip.</p>
            : <p>
              {result.onTrack ? <>Fits in the {hoursText(inputs.hoursLeft)} left, with {hoursText(inputs.hoursLeft - result.hoursNeeded)} to spare.</>
                : <>Needs {hoursText(result.hoursNeeded)}; {hoursText(inputs.hoursLeft)} are left.</>}{" "}
              To finish in time: <strong>{number(result.requiredHandsPerHour ?? 0)} hands/hr</strong> at {money(bet)}, or <strong>{money(result.requiredBetCents ?? 0)} a hand</strong> at {number(inputs.handsPerHour)} hands/hr.
            </p>}
          {result.pointsNeeded > 0 && <div className="luck-band" aria-live="polite">
            <p className="eyebrow">LUCK BAND · RESULT AFTER {number(result.handsNeeded).toUpperCase()} HANDS</p>
            {current?.value ? <>
              <div className="band-row" role="img" aria-label={`Results: 10th percentile ${signed(current.value.p10Cents)}, median ${signed(current.value.p50Cents)}, 90th percentile ${signed(current.value.p90Cents)}`}>
                <span><small>Unlucky (1 in 10)</small><strong>{signed(current.value.p10Cents)}</strong></span>
                <span><small>Typical</small><strong>{signed(current.value.p50Cents)}</strong></span>
                <span><small>Lucky (1 in 10)</small><strong>{signed(current.value.p90Cents)}</strong></span>
              </div>
              <p className="status-note">Finishes ahead {Math.round(current.value.aheadShare * 100)}% of the time. The expected cost ({money(result.expectedCostCents)}) is what skill controls; the rest is luck, mostly whether a royal comes.</p>
            </> : current?.error ? <p className="status-note" role="alert">Couldn't work out the luck band: {current.error}</p>
              : <p className="status-note">Working out the luck band…</p>}
          </div>}
        </div>
      </div>
    </>}
  </section>;
}
