import type { Session } from "@perfect-draw/shared";

/**
 * Coins per line for the next deal: the bet chosen at the table, else the machine's default. A focused drill always
 * uses the bet it was set up for, because its training targets were found in statistics at that exact bet.
 */
export function betForNextDeal(session: Pick<Session, "state" | "machineSnapshot" | "trainingFocus">) {
  return session.trainingFocus ? session.machineSnapshot.coins : session.state.betCoins ?? session.machineSnapshot.coins;
}
