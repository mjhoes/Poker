import { useId } from "react";
import type { ReactNode } from "react";
import type { Machine } from "@perfect-draw/shared";
import { plural } from "../components/UiHelpers";
import { Icon } from "../components/Icons";
import { CardFace } from "../table/CardFace";
import { denominationLabel, gameLabel } from "./machine-info";

// Royal flush in hearts for the attract screen: A K Q J 10.
const ATTRACT = [50, 46, 42, 38, 34];

export type CabinetMachine = Pick<Machine, "name" | "paytableId" | "denominationCents" | "coins" | "lines" | "theme">;

/**
 * A machine drawn as a small cabinet: lit marquee with its name, a glass screen with the game and computed return,
 * and a button deck. Colors come from the machine's felt. Used for floor tiles and the live preview in the editor.
 */
export function MachineCabinet({ machine, returnPct, status, note, actions, preview = false }: {
  machine: CabinetMachine; returnPct?: number; status?: ReactNode; note?: ReactNode; actions?: ReactNode; preview?: boolean;
}) {
  const titleId = useId();
  const game = gameLabel(machine.paytableId);
  const Root = preview ? "div" : "article";
  return <Root className={`cabinet ${preview ? "is-preview" : ""}`} data-felt={machine.theme} aria-labelledby={preview ? undefined : titleId} aria-hidden={preview || undefined}>
    <div className="cabinet-marquee">
      <span className="cabinet-bulbs" aria-hidden="true" />
      <h3 id={titleId}>{machine.name || "New machine"}</h3>
      <span className="cabinet-family">{game.family}</span>
    </div>
    <div className="cabinet-screen">
      {status && <div className="cabinet-status">{status}</div>}
      <span className="screen-game">{game.table}</span>
      <div className="screen-cards" aria-hidden="true">{ATTRACT.map(card => <span key={card} className="mini-card"><CardFace card={card} variant="compact" /></span>)}</div>
      <span className="screen-return">{returnPct ? <><strong>{returnPct.toFixed(2)}%</strong> return{machine.coins < 5 ? " at 5 coins" : ""}</> : <>&nbsp;</>}</span>
    </div>
    <div className="cabinet-deck">
      <div className="cabinet-badges">
        <span className="cabinet-chip"><Icon name="wallet" size={14} />{denominationLabel(machine.denominationCents)}</span>
        <span className="cabinet-chip">{plural(machine.coins, "coin")}{machine.lines > 1 ? ` × ${machine.lines} lines` : ""}</span>
      </div>
      {note && <p className="cabinet-note">{note}</p>}
      {actions && <div className="cabinet-actions">{actions}</div>}
    </div>
  </Root>;
}

/** The empty cabinet at the end of the floor: the obvious way to add a machine. */
export function NewMachineTile({ onClick, large = false }: { onClick: () => void; large?: boolean }) {
  return <button type="button" className={`cabinet cabinet-new ${large ? "is-large" : ""}`} onClick={onClick}>
    <span className="cabinet-new-icon" aria-hidden="true"><Icon name="plus" size={28} /></span>
    <span className="cabinet-new-title">New machine</span>
    <span className="cabinet-new-copy">Pick a game, pay table and bet</span>
  </button>;
}
