import type { FormEvent } from "react";
import { dateTime } from "../components/UiHelpers";

export function SettingsPage({ storageStatus, decisionCount, backupDue, lastBackupAt, busy, onExport, onImport }: {
  storageStatus: string; decisionCount: number; backupDue: boolean; lastBackupAt: number | null; busy: boolean;
  onExport: () => void; onImport: (event: FormEvent<HTMLInputElement>) => void;
}) {
  const statusText = storageStatus === "persistent" ? "Persistent permission granted" : storageStatus === "best-effort" ? "Best-effort storage" : storageStatus === "unavailable" ? "Storage unavailable" : "Checking storage";
  return <><div className="page-heading"><div><p className="eyebrow">LOCAL CONTROL</p><h1>Your room, your records.</h1></div><p className="heading-note">No account and no cloud dependency. Your browser holds the working data; backups are the durable copy you control.</p></div>
    <div className="settings-grid">
      <section className="panel panel-pad">
        <div className="panel-title"><div><p className="eyebrow">STORAGE & BACKUP</p><h2>Know where your work lives.</h2><p>Storage persistence is a browser request, not a promise of permanent safety.</p></div></div>
        <div className="status-card"><div className="detail-label">BROWSER STORAGE</div><div className="storage-status"><span className="storage-icon" aria-hidden="true">{storageStatus === "persistent" ? "P" : storageStatus === "checking" ? "…" : "!"}</span>{statusText}</div><p className="settings-copy">{storageStatus === "persistent" ? "The browser reports persistent storage permission for this origin. Device failure, profile deletion, or browser data clearing can still remove local data." : storageStatus === "best-effort" ? "The browser may evict this origin's data under storage pressure. Export backups regularly; no data safety is guaranteed." : storageStatus === "unavailable" ? "Persistent storage is unavailable. Data may be removed by browser cleanup; export a backup after important changes." : "The browser is checking whether this origin can request persistent storage."}</p></div>
        <div className="backup-actions"><button className="btn" type="button" disabled={busy} onClick={onExport}>{busy ? "Working…" : "Export backup"}</button><label className={`btn secondary ${busy ? "disabled" : ""}`}>Import backup<input aria-label="Import backup file" type="file" accept="application/json,.json" disabled={busy} onChange={onImport} className="visually-hidden" /></label></div>
        <p className="settings-copy" style={{ marginTop: 13 }}>A backup contains wallets, ledger history, machine settings, and saved sessions. Keep it somewhere separate from this browser.</p>
        <div className="warning-card"><strong>Restore replaces everything.</strong> Import erases and replaces all local data, including financial history. Any remembered API keys are erased. The app currently has no keys in this phase. Files over 100 MB are rejected before reading.</div>
      </section>
      <aside className="side-stack">
        <section className="panel panel-pad"><p className="eyebrow">DECISION RECORDS</p><h2 style={{ marginBottom: 8, fontSize: 23 }}>{decisionCount.toLocaleString()} saved</h2><p className="settings-copy">Backup reminder: {backupDue ? "Due — 500 or more decisions since the last export." : "No threshold reached since the last export."}</p><div className="metric-row"><span>Last successful export</span><strong>{lastBackupAt ? dateTime(lastBackupAt) : "Not yet"}</strong></div><div className="metric-row"><span>Reminder threshold</span><strong>500 decisions</strong></div></section>
        <section className="note-card"><p className="eyebrow">PLAIN TERMS</p><h3>Private means local, not invulnerable.</h3><p>Your browser stores the working database. Use backups before clearing site data, changing devices, or relying on long-term records.</p></section>
      </aside>
    </div>
  </>;
}
