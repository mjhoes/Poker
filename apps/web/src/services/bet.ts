import type { Session } from "@perfect-draw/shared";

/**
 * A bet the session sets and the table can't change: a focused drill keeps the bet its statistics were found at, the
 * Strategy Ladder deals at 5 coins because strategy charts are for max bet, and the Pay Table Switcher compares its
 * tables at the machine's bet (a different bet could change the best hold on its own). Null when the bet is the
 * player's.
 */
export function fixedBet(session: Pick<Session, "machineSnapshot" | "trainingFocus"> & { training?: Session["training"] }) {
  if (session.trainingFocus || session.training?.kind === "switcher") return session.machineSnapshot.coins;
  return session.training?.kind === "ladder" ? 5 : null;
}
/** Why the bet can't change, for a session with a fixed bet. */
export function fixedBetReason(session: Pick<Session, "trainingFocus"> & { training?: Session["training"] }) {
  return session.trainingFocus ? "A focused drill keeps the bet it was set up for."
    : session.training?.kind === "switcher" ? "The Pay Table Switcher compares its tables at the machine's bet."
    : "The Strategy Ladder deals at 5 coins: strategy charts are for max bet.";
}
/** Coins per line for the next deal: a fixed bet, else the bet chosen at the table, else the machine's default. */
export function betForNextDeal(session: Pick<Session, "state" | "machineSnapshot" | "trainingFocus"> & { training?: Session["training"] }) {
  return fixedBet(session) ?? session.state.betCoins ?? session.machineSnapshot.coins;
}
/** The pay table of the hand in play: the machine's, or another table of its game in a Pay Table Switcher round. */
export const handPaytableId = (session: Pick<Session, "state" | "machineSnapshot">) => session.state.handPaytableId ?? session.machineSnapshot.paytableId;
