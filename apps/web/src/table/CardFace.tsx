import { memo, useId } from "react";
import { cardRank } from "@perfect-draw/engine";
import { rankLabel, suitName } from "./cards";
import type { SuitName } from "./cards";

/*
 * Original card art drawn on a 100 × 140 grid. Colors come from CSS (currentColor per suit, --card-paper), so the
 * deck follows the theme and a four-color deck is a token change. "compact" drops pips for small sizes.
 */

const W = 100;
const H = 140;

function SuitShape({ suit, x, y, size, flip = false }: { suit: SuitName; x: number; y: number; size: number; flip?: boolean }) {
  const s = size / 24;
  const transform = `${flip ? `rotate(180 ${x} ${y}) ` : ""}translate(${x - size / 2} ${y - size / 2}) scale(${s})`;
  if (suit === "clubs") return <g transform={transform}>
    <circle cx="12" cy="7.4" r="4.6" /><circle cx="6.6" cy="13.6" r="4.6" /><circle cx="17.4" cy="13.6" r="4.6" />
    <path d="M12 11.5 9.2 22h5.6z" /><circle cx="12" cy="12.4" r="2.4" />
  </g>;
  const d = suit === "hearts"
    ? "M12 21.3S2.6 15.6 1.6 9.6C.9 5.6 3.6 2.6 7.1 2.6c2.2 0 3.9 1.2 4.9 3 1-1.8 2.7-3 4.9-3 3.5 0 6.2 3 5.5 7-1 6-10.4 11.7-10.4 11.7z"
    : suit === "diamonds"
      ? "M12 1.8 20.4 12 12 22.2 3.6 12z"
      : "M12 1.8S2.6 9.1 2.6 14.1a4.6 4.6 0 0 0 7.9 3.2L9.3 22.2h5.4l-1.2-4.9a4.6 4.6 0 0 0 7.9-3.2C21.4 9.1 12 1.8 12 1.8z";
  return <path transform={transform} d={d} />;
}

// Pip centres for number cards; pips below the middle are drawn upside down, as on a real deck.
const L = 35, C = 50, R = 65;
const PIPS: Record<number, [number, number][]> = {
  2: [[C, 30], [C, 110]],
  3: [[C, 30], [C, 70], [C, 110]],
  4: [[L, 30], [R, 30], [L, 110], [R, 110]],
  5: [[L, 30], [R, 30], [C, 70], [L, 110], [R, 110]],
  6: [[L, 30], [R, 30], [L, 70], [R, 70], [L, 110], [R, 110]],
  7: [[L, 30], [R, 30], [C, 50], [L, 70], [R, 70], [L, 110], [R, 110]],
  8: [[L, 30], [R, 30], [C, 50], [L, 70], [R, 70], [C, 90], [L, 110], [R, 110]],
  9: [[L, 30], [R, 30], [L, 56.7], [R, 56.7], [C, 70], [L, 83.3], [R, 83.3], [L, 110], [R, 110]],
  10: [[L, 30], [R, 30], [C, 43], [L, 56.7], [R, 56.7], [L, 83.3], [R, 83.3], [C, 97], [L, 110], [R, 110]],
};

function CourtArt({ rank, suit }: { rank: string; suit: SuitName }) {
  const emblem = rank === "K"
    ? <path d="M35 55 38 37l7 8 5-11 5 11 7-8 3 18z M35 57h30v5H35z" />
    : rank === "Q"
      ? <><path d="M35 57c4-13 26-13 30 0z" /><circle cx="35" cy="47" r="3" /><circle cx="50" cy="39" r="3.4" /><circle cx="65" cy="47" r="3" /><path d="M35 58h30v4H35z" /></>
      : <path d="M50 35 62 41.5 59.5 55 50 61l-9.5-6L38 41.5z M50 40.5 57 44.5l-1.6 8.3L50 56.5l-5.4-3.7L43 44.5z" fillRule="evenodd" />;
  return <g className="card-court">
    <rect x="20" y="24" width="60" height="92" rx="5" className="court-panel" />
    <rect x="24" y="28" width="52" height="84" rx="3" className="court-line" />
    <g className="court-emblem">{emblem}</g>
    <text x={C} y="94" textAnchor="middle" className="court-letter">{rank}</text>
    <SuitShape suit={suit} x={C} y={104} size={12} />
  </g>;
}

function CardFaceArt({ card, variant = "full", className = "" }: { card: number; variant?: "full" | "compact"; className?: string }) {
  const rank = rankLabel(card);
  const suit = suitName(card);
  const value = cardRank(card) + 2; // 2..14
  const index = <g className="card-index">
    <text x="12.5" y="25" textAnchor="middle" className={`card-rank ${rank === "10" ? "is-ten" : ""}`}>{rank}</text>
    <SuitShape suit={suit} x={12.5} y={37} size={13} />
  </g>;
  return <svg className={`card-face suit-${suit} ${className}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
    <rect className="card-paper" x="1" y="1" width={W - 2} height={H - 2} rx="8" />
    {variant === "compact" ? <>
      <text x={C} y="66" textAnchor="middle" className={`card-rank-compact ${rank === "10" ? "is-ten" : ""}`}>{rank}</text>
      <SuitShape suit={suit} x={C} y={102} size={40} />
    </> : <>
      {index}
      <g transform={`rotate(180 ${W / 2} ${H / 2})`}>{index}</g>
      {value === 14 && <SuitShape suit={suit} x={C} y={70} size={suit === "spades" ? 46 : 40} />}
      {value >= 11 && value <= 13 && <CourtArt rank={rank} suit={suit} />}
      {value <= 10 && PIPS[value].map(([x, y], pip) => <SuitShape key={pip} suit={suit} x={x} y={y} size={17} flip={y > 70} />)}
    </>}
  </svg>;
}

/** Card art depends only on its props, so it is memoized: a session update re-renders the table, not every pip. */
export const CardFace = memo(CardFaceArt);

/** Face-down card in the table's felt colors. */
function CardBackArt({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return <svg className={`card-back ${className}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
    <defs>
      <pattern id={`lattice-${id}`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="12" height="12" className="back-field" />
        <path d="M0 6h12M6 0v12" className="back-lattice" />
      </pattern>
    </defs>
    <rect className="back-edge" x="1" y="1" width={W - 2} height={H - 2} rx="8" />
    <rect x="8" y="8" width={W - 16} height={H - 16} rx="4" fill={`url(#lattice-${id})`} className="back-frame" />
    <path d="M50 52 62 70 50 88 38 70z" className="back-emblem" />
  </svg>;
}

export const CardBack = memo(CardBackArt);
