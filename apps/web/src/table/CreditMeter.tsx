import { useEffect, useState } from "react";
import type { Session } from "@perfect-draw/shared";
import { creditLabel, grouped, money } from "../components/UiHelpers";
import { dollarsFor } from "../components/ui";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts a win up from zero, like a machine's WIN meter. Instant when the player prefers reduced motion. */
export function useCountUp(target: number, duration = 450) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (target <= 0 || prefersReducedMotion()) { setValue(target); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setValue(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function Meter({ label, value, dollars, tone }: { label: string; value: string; dollars?: string; tone?: "win" | "no-win" }) {
  return <div className={`meter ${tone ? `is-${tone}` : ""}`}>
    <span className="meter-label">{label}</span>
    <span className="meter-value">{value}</span>
    {dollars && <span className="meter-dollars">{dollars}</span>}
  </div>;
}

/** Bottom-edge instrument strip. Free Play shows bet, win and credits; Rapid Drill shows how the drill is going. */
export function CreditMeter({ session, betCoins }: { session: Session; betCoins: number }) {
  const { state, machineSnapshot: config, summary } = session;
  const win = state.phase === "complete" && state.outcome ? state.outcome.totalPayoutCoins : 0;
  const shownWin = useCountUp(win);
  if (session.mode === "drill") {
    const optimal = summary.hands - summary.errors;
    return <div className="credit-meter" aria-label="Drill progress">
      <Meter label="Hands" value={summary.hands.toLocaleString()} />
      <Meter label="Optimal" value={summary.hands ? `${Math.round((optimal / summary.hands) * 100)}%` : "—"} dollars={summary.hands ? `${optimal} of ${summary.hands}` : undefined} />
      <Meter label="EV lost" value={summary.evLost.toFixed(2)} dollars={dollarsFor(summary.evLost, config.denominationCents)} />
    </div>;
  }
  const bet = betCoins * config.lines;
  const creditsCents = Math.round(state.credits * config.denominationCents) + state.creditRemainderCents;
  return <div className="credit-meter" aria-label="Credit meter">
    <Meter label="Bet" value={grouped(bet)} dollars={money(bet * config.denominationCents)} />
    {/* After a draw the win reads 0 and "No win", never the "—" of a hand not yet played. */}
    {state.phase === "complete" && state.outcome && !win
      ? <Meter label="Win" tone="no-win" value="0" dollars="No win" />
      : <Meter label="Win" tone="win" value={win ? grouped(shownWin) : "—"} dollars={win ? money(Math.round(win * config.denominationCents)) : undefined} />}
    <Meter label="Credits" value={creditLabel(state).replace(" credits", "")} dollars={money(creditsCents)} />
  </div>;
}
