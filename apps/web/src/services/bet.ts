import type { Session } from "@perfect-draw/shared";

/**
 * A bet the session sets and the table can't change: a focused drill keeps the bet its statistics were found at, and
 * the Strategy Ladder deals at 5 coins because strategy charts are for max bet. Null when the bet is the player's.
 */
export function fixedBet(session: Pick<Session, "machineSnapshot" | "trainingFocus"> & { training?: Session["training"] }) {
  return session.trainingFocus ? session.machineSnapshot.coins : session.training?.kind === "ladder" ? 5 : null;
}
/** Coins per line for the next deal: a fixed bet, else the bet chosen at the table, else the machine's default. */
export function betForNextDeal(session: Pick<Session, "state" | "machineSnapshot" | "trainingFocus"> & { training?: Session["training"] }) {
  return fixedBet(session) ?? session.state.betCoins ?? session.machineSnapshot.coins;
}
/** The pay table of the hand in play: the machine's, or another table of its game in a Pay Table Switcher round. */
export const handPaytableId = (session: Pick<Session, "state" | "machineSnapshot">) => session.state.handPaytableId ?? session.machineSnapshot.paytableId;
