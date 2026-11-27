import { memo, useId } from "react";
import { rankLabel, suitName } from "./cards";
import type { SuitName } from "./cards";

/*
 * Original card art drawn on a 100 × 140 grid, in the style of a video poker machine's screen: the rank large in the
 * top-left corner with a small suit under it, and one big suit filling the rest of the card, for every rank (no pips,
 * no court figures), so a hand reads at a glance. Colors come from CSS (currentColor per suit, --card-paper), so the
 * deck follows the theme and a four-color deck is a token change. "compact" is the small size: rank over suit.
 */

const W = 100;
const H = 140;

function SuitShape({ suit, x, y, size }: { suit: SuitName; x: number; y: number; size: number }) {
  const transform = `translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`;
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

function CardFaceArt({ card, variant = "full", className = "" }: { card: number; variant?: "full" | "compact"; className?: string }) {
  const rank = rankLabel(card);
  const suit = suitName(card);
  const ten = rank === "10" ? "is-ten" : "";
  return <svg className={`card-face suit-${suit} ${className}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
    <rect className="card-paper" x="1" y="1" width={W - 2} height={H - 2} rx="8" />
    {variant === "compact" ? <>
      <text x={W / 2} y="66" textAnchor="middle" className={`card-rank-compact ${ten}`}>{rank}</text>
      <SuitShape suit={suit} x={W / 2} y={102} size={40} />
    </> : <>
      <text x="22" y="42" textAnchor="middle" className={`card-rank ${ten}`}>{rank}</text>
      <SuitShape suit={suit} x={22} y={58} size={20} />
      <SuitShape suit={suit} x={60} y={98} size={suit === "spades" || suit === "clubs" ? 62 : 64} />
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
