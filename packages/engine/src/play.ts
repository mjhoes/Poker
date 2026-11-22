import { validateHand } from "./cards";
import { evaluateHand } from "./evaluator";
import { getGameFamily } from "./families";
import { validateValueVector } from "./solver";
import type { GameFamilyId, Hand, HandAnalysis, HandRankId, ValueVector } from "./types";

export interface DecisionGrade {
  chosenMask: number; bestMask: number; chosenEv: number; bestEv: number;
  evLoss: number; totalEvLoss: number; chosenLabel: string; bestLabel: string;
  gapToSecond: number; correct: boolean;
}
export interface DrawLine { hand: Hand; rank: HandRankId; payoutCoins: number }
export interface RoundOutcome { lines: DrawLine[]; totalPayoutCoins: number }
function validateMask(mask: number) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 31) throw new RangeError("Invalid hold mask.");
}
function validateLines(lines: number) {
  if (!Number.isInteger(lines) || lines < 1 || lines > 10) throw new RangeError("Expected 1–10 lines.");
}
function shuffle(cards: number[], random: () => number) {
  for (let i = cards.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError("Random source must return a number in [0, 1).");
    const j = Math.floor(value * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
/** Save these independent draw orders at deal time; reloads/retries cannot reroll. */
export function dealRound(lines = 1, random: () => number = Math.random): { hand: Hand; drawDecks: number[][] } {
  validateLines(lines);
  const deck = shuffle(Array.from({ length: 52 }, (_, i) => i), random);
  const hand = deck.slice(0, 5) as unknown as Hand;
  const remaining = deck.slice(5);
  return { hand, drawDecks: Array.from({ length: lines }, () => shuffle([...remaining], random)) };
}
export function resolveRound(hand: Hand, heldMask: number, drawDecks: readonly (readonly number[])[], familyId: GameFamilyId, vector: ValueVector): RoundOutcome {
  validateHand(hand); validateMask(heldMask); validateLines(drawDecks.length);
  validateValueVector(vector, familyId);
  const family = getGameFamily(familyId);
  const lines = drawDecks.map(deck => {
    if (deck.length !== 47 || new Set(deck).size !== 47 || deck.some(card =>
      !Number.isInteger(card) || card < 0 || card >= 52 || hand.includes(card))) throw new Error("Invalid saved draw deck.");
    let position = 0;
    const final = hand.map((card, index) => heldMask & (1 << index) ? card : deck[position++]) as unknown as Hand;
    const rank = evaluateHand(final, familyId);
    return { hand: final, rank, payoutCoins: vector[family.handRanks.indexOf(rank)] };
  });
  return { lines, totalPayoutCoins: lines.reduce((sum, line) => sum + line.payoutCoins, 0) };
}
/** Grading compares to the engine optimum, not to a memorization chart. */
export function gradeDecision(analysis: HandAnalysis, mask: number, lines = 1): DecisionGrade {
  validateMask(mask); validateLines(lines);
  const chosen = analysis.results.find(result => result.mask === mask);
  if (!chosen) throw new Error("The selected hold is missing from the engine analysis.");
  const evLoss = Math.max(0, analysis.best.ev - chosen.ev);
  return {
    chosenMask: mask, bestMask: analysis.best.mask, chosenEv: chosen.ev, bestEv: analysis.best.ev,
    evLoss, totalEvLoss: evLoss * lines, chosenLabel: chosen.label, bestLabel: analysis.best.label,
    gapToSecond: analysis.gapToSecond, correct: evLoss <= 1e-9,
  };
}
