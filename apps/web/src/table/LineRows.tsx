import type { Session } from "@perfect-draw/shared";
import { CoinAmount } from "../components/ui";
import { CardBack, CardFace } from "./CardFace";
import { cardName, winningMask } from "./cards";
import { shortRankName } from "./PayTable";

/**
 * Lines 2…N of a multi-line game, stacked above the main hand as on a multi-play machine. While holding, they show the
 * held cards face up and the rest face down; after the draw, each row shows its final hand, name and payout.
 */
export function LineRows({ session, familyId }: { session: Session; familyId: string }) {
  const { state, machineSnapshot: config } = session;
  if (session.mode !== "free_play" || config.lines < 2) return null;
  const extra = Array.from({ length: config.lines - 1 }, (_, index) => index + 1);
  const dense = config.lines >= 5;
  const outcome = state.phase === "complete" ? state.outcome : null;
  return <div className={`line-rows ${dense ? "is-dense" : ""}`} role="list" aria-label="Other lines">
    {extra.map(lineIndex => {
      const line = outcome?.lines[lineIndex];
      if (line) {
        const winning = winningMask(line.hand, line.rank, familyId);
        const won = line.payoutCoins > 0;
        return <div className={`line-row ${won ? "is-win" : "is-loss"}`} role="listitem" key={lineIndex}
          aria-label={`Line ${lineIndex + 1}: ${line.hand.map(cardName).join(", ")}. ${won ? shortRankName(line.rank) : "No win"}.`}>
          <span className="line-number" aria-hidden="true">{lineIndex + 1}</span>
          <span className="line-cards" aria-hidden="true">{line.hand.map((card, index) =>
            <span key={`${card}-${index}`} className={`mini-card ${won && winning & (1 << index) ? "is-winning" : ""}`}><CardFace card={card} variant="compact" /></span>)}</span>
          <span className="line-result" aria-hidden="true">{won ? <><strong>{shortRankName(line.rank)}</strong><CoinAmount amount={line.payoutCoins} denominationCents={config.denominationCents} unit="" /></> : <span className="line-nothing">—</span>}</span>
        </div>;
      }
      const hand = state.phase === "holding" && state.hand.length === 5 ? state.hand : null;
      return <div className="line-row is-pending" role="listitem" key={lineIndex} aria-label={`Line ${lineIndex + 1}: waiting for the draw.`}>
        <span className="line-number" aria-hidden="true">{lineIndex + 1}</span>
        <span className="line-cards" aria-hidden="true">{[0, 1, 2, 3, 4].map(index => {
          const card = hand && (state.heldMask & (1 << index)) ? hand[index] : null;
          return <span key={card === null ? `back-${index}` : `${card}-${index}`} className="mini-card">{card === null ? <CardBack /> : <CardFace card={card} variant="compact" />}</span>;
        })}</span>
        <span className="line-result" aria-hidden="true" />
      </div>;
    })}
  </div>;
}
