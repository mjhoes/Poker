import type { CSSProperties } from "react";
import { formatCard } from "@perfect-draw/engine";
import { CardFace } from "./CardFace";
import { cardName } from "./cards";

/**
 * One card of the main hand. It is a toggle button while holding; afterwards it stays readable (never faded like a
 * disabled control) and can be marked as part of a win, set aside, or suggested by a hold review.
 */
export function PlayingCard({ card, index, held, disabled, completed, winning, dimmed, suggested, onClick }: {
  card: number; index: number; held: boolean; disabled: boolean; completed: boolean;
  winning?: boolean; dimmed?: boolean; suggested?: boolean; onClick: () => void;
}) {
  const classes = ["hand-card", held && "held", completed && "is-final", winning && "is-winning", dimmed && "is-dimmed", suggested && "is-suggested"].filter(Boolean).join(" ");
  return <button
    type="button"
    data-play-card={index}
    className={classes}
    style={{ "--i": index } as CSSProperties}
    disabled={disabled}
    aria-pressed={completed ? undefined : held}
    aria-label={completed ? `${cardName(card)}, final hand card.` : `${cardName(card)}, ${held ? "held" : "not held"}. ${disabled ? "Hold selection unavailable." : "Toggle hold."}${suggested ? " Part of the stronger hold." : ""}`}
    title={`${formatCard(card)} · press ${index + 1} to toggle`}
    onClick={onClick}
  >
    <span className="card-shell"><CardFace card={card} /></span>
    {!completed && <span className="held-chip" aria-hidden="true">{held ? "HELD" : <span className="card-key">{index + 1}</span>}</span>}
  </button>;
}
