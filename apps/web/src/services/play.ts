import { canonicalizeHand, gradeDecision, standardVariant } from "@perfect-draw/engine";
import { analysisKey } from "@perfect-draw/paytables";
import {
  decisionSchema, drawDecksSchema, handAnalysisSchema, newId, outcomeSchema, sessionSchema, uuid,
} from "@perfect-draw/shared";
import type { PlayService, Session } from "@perfect-draw/shared";
import type { EngineAPI } from "../worker/engine-api";
import { engineClient } from "../worker/client";
import { db, requireRecord, stamp } from "../data/db";
import { postLedger } from "./wallets";
import { decisionService } from "./decisions";
import { creditState } from "./money";

type PlayEngine = Pick<EngineAPI, "prepareRound" | "resolveRound">;
const transactionTables = () => [db.records("sessions"), db.records("wallets"), db.records("walletLedger"), db.records("decisions")];
const active = (session: Session) => {
  if (session.status !== "active") throw new Error("Resume this session before playing.");
  if (!["free_play", "drill"].includes(session.mode)) throw new Error("Unsupported play mode.");
  if (session.variant.kind !== "standard" || session.machineSnapshot.variant.kind !== "standard") throw new Error("This game variant is not supported yet.");
};
const safeCents = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("This payout or bet cannot be represented as whole safe cents.");
  return value;
};
/** Dependency injection is for deterministic tests; production always uses the real worker. */
export function createPlayService(getEngine: () => PlayEngine = engineClient): PlayService {
  return {
    async deal(id: string, expectedHandId: string | null) {
      uuid.parse(id); if (expectedHandId !== null) uuid.parse(expectedHandId);
      const initial = await requireRecord("sessions", id); active(initial);
      if (initial.state.handId !== expectedHandId) throw new Error("This session has moved to another hand.");
      if (initial.state.handId && initial.state.phase === "holding") throw new Error("Finish the current hand before dealing.");
      const config = initial.machineSnapshot;
      const prepared = await getEngine().prepareRound(config.paytableId, config.coins, initial.mode === "drill" ? 1 : config.lines, initial.trainingFocus);
      const analysis = handAnalysisSchema.parse(prepared.analysis);
      const drawDecks = drawDecksSchema.parse(prepared.drawDecks);
      if (drawDecks.length !== (initial.mode === "drill" ? 1 : config.lines) ||
        drawDecks.some(deck => deck.some(card => analysis.hand.includes(card)))) throw new Error("The engine returned inconsistent draw decks.");
      return db.transaction("rw", transactionTables(), async () => {
        const session = await requireRecord("sessions", id); active(session);
        if (session.state.handId !== expectedHandId) return session; // A concurrent deal already committed.
        if (session.state.handId && session.state.phase === "holding") throw new Error("Finish the current hand.");
        let balanceDisplay = creditState((await requireRecord("wallets", session.walletId)).balanceCents, config.denominationCents);
        const bet = session.mode === "drill" ? 0 : safeCents(standardVariant.betCoins(config.coins, config.lines) * config.denominationCents);
        if (bet) {
          const wallet = await requireRecord("wallets", session.walletId);
          if (wallet.balanceCents < bet) throw new Error("Insufficient credits in this wallet. Add credits to keep playing.");
          balanceDisplay = creditState((await postLedger(session.walletId, -bet, "bet", { sessionId: id })).balanceCents, config.denominationCents);
        }
        const now = Date.now();
        const next = sessionSchema.parse({
          ...session, updatedAt: now,
          summary: { ...session.summary, coinInCents: session.summary.coinInCents + bet, netCents: session.summary.netCents - bet },
          state: {
            ...session.state, hand: analysis.hand, heldMask: 0, phase: "holding", ...balanceDisplay, primaryGrade: null,
            handId: newId(), handIndex: session.summary.hands + 1, dealtAt: now, decisionStartedAt: now,
            decisionElapsedMs: 0, analysis, drawDecks, warning: null, feedback: null, outcome: null, attempts: 0,
          },
        });
        await db.records("sessions").put(next); return next;
      });
    },
    async submit(id: string, handId: string, confirmMistake = false) {
      uuid.parse(id); uuid.parse(handId);
      const initial = await requireRecord("sessions", id); active(initial);
      if (initial.state.handId !== handId) throw new Error("This hand is no longer current.");
      if (initial.state.phase === "complete") return initial; // Repeat clicks never pay or log twice.
      const analysis = initial.state.analysis;
      if (!analysis || initial.state.phase !== "holding") throw new Error("Deal a hand first.");
      const mask = initial.state.heldMask;
      const config = initial.machineSnapshot;
      const submittedAt = Date.now();
      const grade = gradeDecision(analysis, mask, initial.mode === "drill" ? 1 : config.lines);
      const warn = initial.mode === "free_play" && initial.state.feedbackMode === "warn_before_draw" && !grade.correct;
      if (confirmMistake && (!warn || initial.state.warning?.chosenMask !== mask)) throw new Error("Review this hold before confirming the warning.");
      const shouldWarn = warn && !confirmMistake;
      const outcome = initial.mode === "free_play" && !shouldWarn
        ? outcomeSchema.parse(await getEngine().resolveRound(analysis.hand, mask, initial.state.drawDecks, config.paytableId, config.coins)) : null;
      if (outcome && outcome.lines.length !== config.lines) throw new Error("Engine line count does not match this machine.");
      return db.transaction("rw", transactionTables(), async () => {
        const session = await requireRecord("sessions", id); active(session);
        if (session.state.handId !== handId) throw new Error("This hand is no longer current.");
        if (session.state.phase === "complete") return session;
        if (session.state.heldMask !== mask || session.state.feedbackMode !== initial.state.feedbackMode) throw new Error("Your hold or feedback mode changed. Submit the current selection again.");
        // Repeated warning/confirmation clicks reuse the logged attempt.
        const reuseWarning = session.state.warning?.chosenMask === mask;
        let attempts = session.state.attempts;
        if (!reuseWarning) {
          const decision = decisionSchema.parse({
            id: attempts === 0 ? handId : newId(), ...stamp(), sessionId: id, handId,
            paytableId: config.paytableId, analysisKey: analysisKey(analysis.familyId, analysis.valueVector, config.coins),
            variantKind: session.variant.kind, variantState: session.state.variantState,
            canonicalHandId: canonicalizeHand(analysis.hand).id, dealtCards: analysis.hand,
            ...grade, decisionMs: session.state.decisionElapsedMs + Math.max(0, submittedAt - (session.state.decisionStartedAt ?? submittedAt)),
            handIndexInSession: session.state.handIndex, msSinceSessionStart: Math.max(0, submittedAt - session.startedAt),
            priorOutcome: session.state.priorOutcome, createdAt: submittedAt, attemptIndex: attempts,
            isCorrection: attempts > 0, coins: config.coins, lines: initial.mode === "drill" ? 1 : config.lines,
            denominationCents: config.denominationCents,
          });
          await decisionService.record(decision); attempts++;
        }
        if (shouldWarn) {
          const next = sessionSchema.parse({ ...session, updatedAt: Date.now(), state: { ...session.state, warning: grade, attempts, primaryGrade: session.state.primaryGrade ?? grade } });
          await db.records("sessions").put(next); return next;
        }
        const first = await db.records("decisions").get(handId);
        if (!first && !session.state.primaryGrade) throw new Error("Original decision record is missing.");
        const firstGrade = first ? gradeDecision(analysis, first.chosenMask, initial.mode === "drill" ? 1 : config.lines) : session.state.primaryGrade!;
        const payout = outcome ? safeCents(outcome.totalPayoutCoins * config.denominationCents) : 0;
        let balanceDisplay = creditState((await requireRecord("wallets", session.walletId)).balanceCents, config.denominationCents);
        if (payout) balanceDisplay = creditState((await postLedger(session.walletId, payout, "win", { sessionId: id })).balanceCents, config.denominationCents);
        const mistakeCounts = { ...session.summary.mistakeCounts };
        if (!firstGrade.correct) {
          const label = `${firstGrade.bestLabel} → ${firstGrade.chosenLabel}`;
          mistakeCounts[label] = (mistakeCounts[label] ?? 0) + 1;
        }
        const next = sessionSchema.parse({
          ...session, updatedAt: Date.now(),
          summary: {
            ...session.summary, hands: session.summary.hands + 1,
            netCents: session.summary.netCents + payout,
            errors: session.summary.errors + (firstGrade.correct ? 0 : 1),
            evLost: session.summary.evLost + firstGrade.totalEvLoss,
            biggestWinCents: Math.max(session.summary.biggestWinCents, payout),
            mistakeCounts,
            topMistakes: Object.entries(mistakeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, count]) => ({ label, count })),
          },
          state: {
            ...session.state, phase: "complete", ...balanceDisplay, attempts, warning: null, feedback: grade, outcome,
            hand: outcome?.lines[0].hand ?? session.state.hand, decisionStartedAt: null,
            priorOutcome: outcome ? outcome.lines.map(line => line.rank).join(",") : grade.correct ? "correct" : "mistake",
          },
        });
        await db.records("sessions").put(next); return next;
      });
    },
  };
}
export const playService = createPlayService();
