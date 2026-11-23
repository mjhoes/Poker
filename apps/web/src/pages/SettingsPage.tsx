import type { FormEvent } from "react";
import type { Machine, Paytable } from "@perfect-draw/shared";
import { Button, ChoiceChips, MenuButton } from "../components/ui";
import { CardFace } from "../table/CardFace";
import { Icon } from "../components/Icons";
import { dateTime, familyName, plural } from "../components/UiHelpers";

// A♠ K♥ Q♦ J♣: one card per suit, so the choice previews itself.
const PREVIEW_CARDS = [51, 46, 41, 36];

function CardColorsPanel({ value, onChange }: { value: "two" | "four"; onChange: (value: "two" | "four") => void }) {
  return <section className="panel panel-pad card-colors-panel">
    <p className="eyebrow">CARDS</p><h2 className="panel-heading-sm">Card colors</h2>
    <ChoiceChips label="Card colors" value={value} onChange={onChange} choices={[
      { value: "two", label: "Two colors", hint: "Classic red and black" },
      { value: "four", label: "Four colors", hint: "Blue diamonds, green clubs" },
    ]} />
    <div className="deck-preview" aria-hidden="true">{PREVIEW_CARDS.map(card => <span key={card} className="mini-card"><CardFace card={card} /></span>)}</div>
  </section>;
}

/** Hand-entered pay tables: available to every machine, renamable, removable once nothing uses them. */
function PayTablesPanel({ paytables, machines, onNew, onCopy, onRename, onDelete }: {
  paytables: Paytable[]; machines: Machine[]; onNew: () => void; onCopy: (table: Paytable) => void;
  onRename: (table: Paytable) => void; onDelete: (table: Paytable) => void;
}) {
  return <section className="panel panel-pad paytables-panel" aria-labelledby="paytables-heading">
    <div className="panel-title">
      <div><p className="eyebrow">PAY TABLES</p><h2 id="paytables-heading">Your pay tables</h2><p>Enter any machine's pays by hand. The engine computes its exact return and strategy.</p></div>
      <Button icon="plus" onClick={onNew}>New pay table</Button>
    </div>
    {paytables.length ? paytables.map(table => {
      const used = machines.filter(machine => machine.paytableId === table.id).length;
      return <div className="list-row" key={table.id}>
        <div className="list-main"><strong>{table.name}</strong><span>{familyName(table.familyId)}{table.computed ? ` · ${table.computed.returnPct.toFixed(2)}% return` : ""} · {used ? `used by ${plural(used, "machine")}` : "not used yet"}</span></div>
        <MenuButton label={`More actions for ${table.name}`} items={[
          { label: "Rename", icon: "edit", onSelect: () => onRename(table) },
          { label: "Edit a copy", icon: "copy", onSelect: () => onCopy(table) },
          { label: "Delete", icon: "trash", tone: "danger", onSelect: () => onDelete(table) },
        ]} />
      </div>;
    }) : <p className="settings-copy">Nothing yet. Pay tables you enter appear here and in the machine editor's game picker.</p>}
  </section>;
}

export function SettingsPage({ storageStatus, decisionCount, backupDue, lastBackupAt, busy, onExport, onImport, paytables, machines, onNewPaytable, onCopyPaytable, onRenamePaytable, onDeletePaytable, deckColors, onDeckColors }: {
  deckColors: "two" | "four"; onDeckColors: (value: "two" | "four") => void;
  storageStatus: string; decisionCount: number; backupDue: boolean; lastBackupAt: number | null; busy: boolean;
  onExport: () => void; onImport: (event: FormEvent<HTMLInputElement>) => void;
  paytables: Paytable[]; machines: Machine[]; onNewPaytable: () => void; onCopyPaytable: (table: Paytable) => void;
  onRenamePaytable: (table: Paytable) => void; onDeletePaytable: (table: Paytable) => void;
}) {
  const statusText = storageStatus === "persistent" ? "Persistent permission granted" : storageStatus === "best-effort" ? "Best-effort storage" : storageStatus === "unavailable" ? "Storage unavailable" : "Checking storage";
  return <><div className="page-heading"><div><p className="eyebrow">SETTINGS</p><h1>Your data, your copy.</h1></div><p className="heading-note">Everything is stored in this browser. A backup file is your safe copy.</p></div>
    <div className="settings-grid">
      <section className="panel panel-pad">
        <div className="panel-title"><div><p className="eyebrow">STORAGE & BACKUP</p><h2>Back up your data</h2></div></div>
        <div className="status-card"><div className="detail-label">BROWSER STORAGE</div><div className="storage-status"><span className="storage-icon" aria-hidden="true">{storageStatus === "persistent" ? "P" : storageStatus === "checking" ? "…" : "!"}</span>{statusText}</div><p className="settings-copy">{storageStatus === "persistent" ? "The browser reports persistent storage permission for this origin. Device failure, profile deletion, or browser data clearing can still remove local data." : storageStatus === "best-effort" ? "The browser may evict this origin's data under storage pressure. Export backups regularly; no data safety is guaranteed." : storageStatus === "unavailable" ? "Persistent storage is unavailable. Data may be removed by browser cleanup; export a backup after important changes." : "The browser is checking whether this origin can request persistent storage."}</p></div>
        <div className="backup-actions"><Button icon="download" loading={busy} onClick={onExport}>Export backup</Button><label className={`btn secondary ${busy ? "disabled" : ""}`}><Icon name="upload" size={17} />Import backup<input aria-label="Import backup file" type="file" accept="application/json,.json" disabled={busy} onChange={onImport} className="visually-hidden" /></label></div>
        <p className="settings-copy" style={{ marginTop: 13 }}>A backup includes your wallets, machines, sessions and statistics. Keep it somewhere other than this browser.</p>
        <div className="warning-card"><strong>Restoring replaces everything.</strong> Importing a backup erases all data on this device and replaces it with the backup's contents.</div>
      </section>
      <aside className="side-stack">
        <CardColorsPanel value={deckColors} onChange={onDeckColors} />
        <section className="panel panel-pad"><p className="eyebrow">DECISION RECORDS</p><h2 style={{ marginBottom: 8, fontSize: 23 }}>{decisionCount.toLocaleString()} saved</h2><p className="settings-copy">Backup reminder: {backupDue ? "Due — 500 or more decisions since the last export." : "No threshold reached since the last export."}</p><div className="metric-row"><span>Last successful export</span><strong>{lastBackupAt ? dateTime(lastBackupAt) : "Not yet"}</strong></div><div className="metric-row"><span>Reminder threshold</span><strong>500 decisions</strong></div></section>
        <section className="note-card"><p className="eyebrow">GOOD TO KNOW</p><h3>Clearing browser data erases your history.</h3><p>Export a backup before clearing site data or switching devices.</p></section>
      </aside>
    </div>
    <PayTablesPanel paytables={paytables} machines={machines} onNew={onNewPaytable} onCopy={onCopyPaytable} onRename={onRenamePaytable} onDelete={onDeletePaytable} />
  </>;
}
