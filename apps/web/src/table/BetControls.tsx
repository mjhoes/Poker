import type { Session } from "@perfect-draw/shared";
import { ChoiceChips } from "../components/ui";
import { Icon } from "../components/Icons";
import { money } from "../components/UiHelpers";
import { findPaytable } from "../paytables/catalog";
import { betForNextDeal, fixedBet } from "../services/bet";

/** The bet that applies right now: the locked bet of a hand in play, otherwise the bet chosen for the next deal. */
export function currentBet(session: Session) {
  const { state, machineSnapshot } = session;
  const locked = state.phase === "holding" && !!state.handId;
  return {
    coins: locked ? state.handCoins ?? machineSnapshot.coins : betForNextDeal(session),
    locked,
    /** A focused drill's bet is part of what it trains; the Strategy Ladder plays max bet. */
    fixed: fixedBet(session) !== null,
  };
}

/** "Below max bet the royal pays 1,000; at 5 coins it pays 4,000" for tables with a max-bet royal bonus. */
export function shortBetNote(paytableId: string, coins: number) {
  if (coins >= 5) return null;
  const pays = findPaytable(paytableId)?.pays;
  const royal = pays?.ROYAL_FLUSH ?? pays?.NATURAL_ROYAL;
  if (!royal || royal[4] <= royal[0] * 5) return null;
  return `At ${coins} coin${coins === 1 ? "" : "s"} the royal pays ${royal[coins - 1].toLocaleString("en-US")}; at 5 coins it pays ${royal[4].toLocaleString("en-US")}. Max bet is usually best.`;
}

/**
 * Credits per line, chosen between hands like a machine's BET ONE / BET MAX buttons. Locked while a hand is in play,
 * because that hand was already paid for at its bet.
 */
export function BetControls({ session, busy, onBet }: { session: Session; busy: boolean; onBet: (coins: number) => void }) {
  const { coins, locked, fixed } = currentBet(session);
  const config = session.machineSnapshot;
  const lines = session.mode === "drill" ? 1 : config.lines;
  const note = shortBetNote(config.paytableId, coins);
  const disabled = locked || fixed || busy || session.status !== "active";
  return <div className={`bet-controls ${locked ? "is-locked" : ""}`}>
    <span className="bet-label">Bet</span>
    <ChoiceChips label="Credits per line" value={String(coins)} onChange={value => onBet(Number(value))}
      choices={["1", "2", "3", "4", "5"].map(value => ({ value, label: value, name: `${value} credit${value === "1" ? "" : "s"}`, disabled }))} />
    <span className="bet-total">
      {locked ? <><Icon name="info" size={14} />Locked for this hand</> : fixed ? <>{session.trainingFocus ? "Set by this focused drill" : session.training?.kind === "switcher" ? "Every table at the machine's bet" : "Strategy charts are for max bet"}</> : session.mode === "drill"
        ? <>Practice at this bet · no wager</>
        : <>{money(coins * lines * config.denominationCents)} per hand{lines > 1 ? ` (${lines} lines)` : ""}</>}
    </span>
    {note && !locked && !fixed && <p className="bet-note">{note}</p>}
  </div>;
}
