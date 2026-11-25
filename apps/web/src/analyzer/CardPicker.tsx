import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { RANK_LABELS, cardName } from "../table/cards";

/** Display order: spades, hearts, diamonds, clubs (card number = rank × 4 + suit, suits c d h s). */
const SUIT_ROWS = [3, 2, 1, 0] as const;
const SUIT_INFO = [
  { name: "clubs", symbol: "♣" }, { name: "diamonds", symbol: "♦" }, { name: "hearts", symbol: "♥" }, { name: "spades", symbol: "♠" },
] as const;
const RANKS_HIGH_FIRST = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

/**
 * Pick cards for the hand. Larger screens get the whole deck as a 4 × 13 grid (arrow keys move, Enter or Space picks);
 * phones get a rank row then a suit row. Picking a card already in the hand removes it.
 */
export function CardPicker({ cards, onToggle }: { cards: readonly number[]; onToggle: (card: number) => void }) {
  const full = cards.length >= 5;
  const [focus, setFocus] = useState(RANKS_HIGH_FIRST[0] * 4 + 3);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const [rank, setRank] = useState<number | null>(null);

  const onKeyDown = (event: KeyboardEvent, card: number) => {
    const row = SUIT_ROWS.indexOf(card % 4 as 0 | 1 | 2 | 3), column = RANKS_HIGH_FIRST.indexOf(Math.floor(card / 4));
    const move = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[event.key];
    if (!move) return;
    event.preventDefault();
    const nextRow = (row + move[0] + 4) % 4, nextColumn = (column + move[1] + 13) % 13;
    const next = RANKS_HIGH_FIRST[nextColumn] * 4 + SUIT_ROWS[nextRow];
    setFocus(next);
    buttons.current.get(next)?.focus();
  };

  return <div className="card-picker">
    <div className="picker-grid" role="group" aria-label="Deck: pick five cards">
      {SUIT_ROWS.map(suit => <div key={suit} className="picker-row">
        {RANKS_HIGH_FIRST.map(rankIndex => {
          const card = rankIndex * 4 + suit;
          const inHand = cards.includes(card);
          return <button key={card} ref={element => { if (element) buttons.current.set(card, element); }} type="button"
            className={`picker-card suit-${SUIT_INFO[suit].name} ${inHand ? "is-picked" : ""}`}
            aria-pressed={inHand} aria-label={cardName(card)} disabled={full && !inHand} tabIndex={card === focus ? 0 : -1}
            onFocus={() => setFocus(card)} onKeyDown={event => onKeyDown(event, card)} onClick={() => onToggle(card)}>
            <span>{RANK_LABELS[rankIndex]}</span><span aria-hidden="true">{SUIT_INFO[suit].symbol}</span>
          </button>;
        })}
      </div>)}
    </div>

    <div className="picker-steps">
      <div className="picker-step-row" role="group" aria-label="Rank">
        {RANKS_HIGH_FIRST.map(rankIndex => <button key={rankIndex} type="button" className={`picker-rank ${rank === rankIndex ? "selected" : ""}`}
          aria-pressed={rank === rankIndex} disabled={full || [0, 1, 2, 3].every(suit => cards.includes(rankIndex * 4 + suit))}
          onClick={() => setRank(rank === rankIndex ? null : rankIndex)}>{RANK_LABELS[rankIndex]}</button>)}
      </div>
      <div className="picker-step-row" role="group" aria-label="Suit">
        {SUIT_ROWS.map(suit => {
          const card = rank === null ? null : rank * 4 + suit;
          return <button key={suit} type="button" className={`picker-suit suit-${SUIT_INFO[suit].name}`}
            aria-label={card === null ? SUIT_INFO[suit].name : cardName(card)} disabled={card === null || full || cards.includes(card)}
            onClick={() => { if (card !== null) { onToggle(card); setRank(null); } }}>{SUIT_INFO[suit].symbol}</button>;
        })}
      </div>
      <p className="picker-hint">{full ? "Five cards picked. Tap a card above to remove it." : rank === null ? "Tap a rank, then a suit." : `${RANK_LABELS[rank]} of… pick a suit.`}</p>
    </div>
  </div>;
}
