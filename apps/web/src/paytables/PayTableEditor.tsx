import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { standardVariant } from "@perfect-draw/engine";
import type { GameFamilyId } from "@perfect-draw/engine";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import { Field, familyName, handRankName } from "../components/UiHelpers";
import { Button, ChoiceChips, Disclosure } from "../components/ui";
import { Icon } from "../components/Icons";
import { engineClient } from "../worker/client";
import type { GamePreview } from "../worker/engine-api";
import type { Run } from "../hooks/useActionRunner";
import { paytableService } from "../services/paytables";
import type { SaveResult } from "../services/paytables";
import { useAllPaytables } from "./catalog";
import type { PaytableInfo } from "./catalog";
import { draftFromLibrary, finalize, isRoyal, libraryMatch, parsePasted, payingRanks, perCoin, quickFill, setCell, setPerCoin, shorthandRows, validate } from "./model";
import type { DraftTable } from "./model";
import { useLibraryReturns } from "../machines/machine-info";
import { closestLibraryTable } from "../photo/closest-table";
import { photoChecks, readPaytable } from "../photo/paytable-photo";
import type { PaytableReply } from "../photo/paytable-photo";

const FAMILIES = [...new Set(PAY_TABLE_LIBRARY.map(table => table.familyId))];
const previews = new Map<string, GamePreview>();

/** Engine return for the current pays, recomputed after a pause in typing; one computation at a time. */
function useLivePreview(draft: DraftTable, enabled: boolean) {
  const { id } = useMemo(() => finalize(draft), [draft]);
  const [, setTick] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const latest = useRef({ id, draft });
  const running = useRef(false);
  latest.current = { id, draft };

  useEffect(() => {
    if (!enabled || previews.has(id)) return;
    const timer = window.setTimeout(() => {
      const runNext = async () => {
        if (running.current) return;
        const { id: target, draft: current } = latest.current;
        if (previews.has(target)) return;
        running.current = true; setPending(target); setError("");
        try {
          const table = finalize(current);
          previews.set(target, await engineClient().previewGame(table.familyId, standardVariant.valueVector(table, 5, {})));
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally {
          running.current = false; setPending(null); setTick(value => value + 1);
          if (latest.current.id !== target && !previews.has(latest.current.id)) void runNext();
        }
      };
      void runNext();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [id, enabled]);
  return { id, preview: previews.get(id), computing: pending !== null || (enabled && !previews.has(id) && !error), error };
}

function suggestedName(draft: DraftTable) {
  const rows = shorthandRows(draft.familyId);
  if (draft.familyId === "deuces_wild") return `Custom ${familyName(draft.familyId)}`;
  return `${perCoin(draft, rows[0])}/${perCoin(draft, rows[1])} ${familyName(draft.familyId)}`;
}

/**
 * Enter a pay table by hand: pick the game, start from a known table, then type the numbers printed on the glass,
 * use shorthand like "9/6", or paste a table. The engine computes the return live; checks flag likely typos.
 * A pay table read from a photo lands here too (`photo`), for the player to confirm: doubtful rows are highlighted,
 * printed rows the app couldn't name are listed for assigning, and the photo is shown alongside.
 */
export function PayTableEditor({ startFrom, initialFamily, photo, busy, run, onSaved, onCancel }: {
  startFrom?: PaytableInfo; initialFamily?: GameFamilyId; busy: boolean; run: Run;
  photo?: { reply: PaytableReply; imageUrl: string; source: string };
  onSaved: (result: SaveResult) => void; onCancel: () => void;
}) {
  const [reading, setReading] = useState(() => photo ? readPaytable(photo.reply) : null);
  const all = useAllPaytables();
  const returns = useLibraryReturns();
  const [draft, setDraft] = useState<DraftTable>(() => reading ? reading.draft : startFrom
    ? { familyId: startFrom.familyId, pays: Object.fromEntries(Object.entries(startFrom.pays).map(([rank, row]) => [rank, [...row] as [number, number, number, number, number]])) }
    : draftFromLibrary(initialFamily ?? FAMILIES[0]));
  const [name, setName] = useState(startFrom && startFrom.source !== "library" ? `${startFrom.name} (copy)` : "");
  const [allColumns, setAllColumns] = useState(!!photo);
  const [unknown, setUnknown] = useState(reading?.unknown ?? []);
  const [shorthand, setShorthand] = useState("");
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [error, setError] = useState("");

  // With a photo: hands still missing get the photo's message instead of the generic "pays nothing".
  const stillMissing = reading ? reading.missing.filter(rank => (draft.pays[rank] ?? []).every(value => !value)) : [];
  const issues = [...validate(draft, handRankName).filter(issue => !(issue.level === "warning" && issue.rank && stillMissing.includes(issue.rank))),
    ...(reading ? photoChecks(draft, stillMissing) : [])];
  const errors = issues.filter(issue => issue.level === "error");
  const match = libraryMatch(draft);
  const { preview, computing, error: previewError } = useLivePreview(draft, errors.length === 0);
  const ranks = payingRanks(draft.familyId);
  const sources = all.filter(table => table.familyId === draft.familyId);
  const rowIssue = (rank: string) => issues.find(issue => issue.rank === rank);

  const changeFamily = (familyId: GameFamilyId) => {
    // A photo's rows are re-read as the chosen game rather than thrown away.
    if (photo) { const next = readPaytable(photo.reply, familyId); setReading(next); setDraft(next.draft); setUnknown(next.unknown); }
    else setDraft(draftFromLibrary(familyId));
    setMessage(null); setShorthand("");
  };
  const assign = (index: number, rank: string) => {
    const row = unknown[index];
    setDraft(current => ({ ...current, pays: { ...current.pays, [rank]: [...row.pays] as [number, number, number, number, number] } }));
    setUnknown(current => current.filter((_, position) => position !== index));
    setReading(current => current && { ...current, doubtful: [...new Set([...current.doubtful, rank])] });
  };
  const closest = reading && !match ? closestLibraryTable(draft) : null;
  const applyShorthand = () => {
    const result = quickFill(draft, shorthand);
    if ("error" in result) { setMessage({ tone: "warn", text: result.error }); return; }
    setDraft(result.draft);
    setMessage({ tone: "ok", text: `Set ${result.changed.map(rank => `${handRankName(rank)} to ${perCoin(result.draft, rank)}`).join(", ")}.` });
  };
  const applyPaste = () => {
    const result = parsePasted(draft, pasted);
    setDraft(result.draft);
    setMessage(result.changed.length
      ? { tone: result.unmatched.length ? "warn" : "ok", text: `Filled ${result.changed.length} hand${result.changed.length === 1 ? "" : "s"}.${result.unmatched.length ? ` Couldn't read: ${result.unmatched.map(line => `“${line}”`).join(", ")}.` : ""}` }
      : { tone: "warn", text: "No hands recognized. Put one hand per line with its pay, e.g. “Full House 9”." });
  };
  const numberValue = (text: string) => text.trim() === "" ? NaN : Number(text);
  const editCell = (next: DraftTable) => { setDraft(next); setMessage(null); };

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (errors.length) { setError(errors[0].message); return; }
    await run(async () => {
      const table = finalize(draft);
      const computed = preview ?? await engineClient().previewGame(table.familyId, standardVariant.valueVector(table, 5, {}));
      onSaved(await paytableService.saveCustom({ name: name.trim() || suggestedName(draft), draft, computed }));
    }, { onError: setError });
  }

  return <form className="paytable-editor" onSubmit={event => void save(event)}>
    <div className="paytable-editor-main">
      {error && <div className="error-banner" role="alert">{error}</div>}
      <section className="sheet-step">
        <h3><span className="step-number">1</span>Game</h3>
        <ChoiceChips label="Game" value={draft.familyId} onChange={changeFamily} autoFocus
          choices={FAMILIES.map(id => ({ value: id, label: familyName(id) }))} />
        <p className="field-label sheet-sub">Start from</p>
        <div className="start-from">
          {sources.map(table => <button key={table.id} type="button" className={`choice ${finalize(draft).id === table.id ? "selected" : ""}`}
            onClick={() => { setDraft({ familyId: table.familyId, pays: Object.fromEntries(Object.entries(table.pays).map(([rank, row]) => [rank, [...row] as [number, number, number, number, number]])) }); setMessage(null); }}>
            <span className="choice-label">{table.name}</span>
            <span className="choice-hint">{returns.get(table.id) ? `${returns.get(table.id)!.toFixed(2)}%` : table.source === "library" ? "Built-in" : "Yours"}</span>
          </button>)}
        </div>
      </section>

      <section className="sheet-step">
        <h3><span className="step-number">2</span>Pays</h3>
        <div className="shorthand-row">
          <label className="field shorthand-field"><span className="field-label">Shorthand</span>
            <input aria-label="Pay table shorthand" placeholder={draft.familyId === "deuces_wild" ? "200/25/15/9/5/3/2/2/1" : "9/6"} value={shorthand}
              onChange={event => setShorthand(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyShorthand(); } }} />
            <small>{draft.familyId === "deuces_wild" ? "Per-coin pays from Four Deuces down, or every hand from the top." : "Full house / flush (/ straight), e.g. 8/5 — or every pay from the royal down."}</small>
          </label>
          <Button variant="secondary" disabled={!shorthand.trim()} onClick={applyShorthand}>Apply</Button>
        </div>
        <Disclosure summary="Paste a pay table">
          <label className="field paste-field"><span className="visually-hidden">Pasted pay table</span>
            <textarea aria-label="Pasted pay table" rows={5} value={pasted} onChange={event => setPasted(event.target.value)}
              placeholder={"Royal Flush 250 500 750 1000 4000\nFour of a Kind 25\nFull House 9\nFlush 6"} /></label>
          <Button variant="secondary" size="sm" disabled={!pasted.trim()} onClick={applyPaste}>Read pasted text</Button>
        </Disclosure>
        {message && <p className={`editor-message is-${message.tone}`} role="status"><Icon name={message.tone === "ok" ? "check" : "info"} size={15} />{message.text}</p>}

        <div className="pays-grid-head">
          <span>Pays per coin, as printed on the machine</span>
          <label className="column-toggle"><input type="checkbox" checked={allColumns} onChange={event => setAllColumns(event.target.checked)} />Edit every coin column</label>
        </div>
        <table className={`pays-grid ${allColumns ? "is-full" : ""}`}>
          <thead><tr><th scope="col">Hand</th>{allColumns ? [1, 2, 3, 4, 5].map(column => <th key={column} scope="col">{column} coin{column === 1 ? "" : "s"}</th>) : <><th scope="col">Per coin</th><th scope="col">At 5 coins</th></>}</tr></thead>
          <tbody>{ranks.map(rank => {
            const row = draft.pays[rank] ?? [0, 0, 0, 0, 0];
            const issue = rowIssue(rank);
            const doubtful = reading?.doubtful.includes(rank) ?? false;
            return <tr key={rank} className={`${issue ? `has-${issue.level}` : ""} ${doubtful ? "is-doubtful" : ""}`}>
              <th scope="row">{handRankName(rank)}{doubtful && <span className="row-doubt" title="Check this row against the photo">Check<span className="visually-hidden"> against the photo</span></span>}{issue && <span className="row-issue" title={issue.message}><Icon name="warning" size={14} /><span className="visually-hidden">{issue.message}</span></span>}</th>
              {allColumns ? row.map((value, column) => <td key={column}><input aria-label={`${handRankName(rank)}, ${column + 1} coin${column ? "s" : ""}`} inputMode="numeric" value={Number.isNaN(value) ? "" : value}
                onChange={event => editCell(setCell(draft, rank, column, numberValue(event.target.value)))} /></td>)
                : <>
                  <td><input aria-label={`${handRankName(rank)} pays per coin`} inputMode="numeric" value={Number.isNaN(row[0]) ? "" : row[0]}
                    onChange={event => editCell(setPerCoin(draft, rank, numberValue(event.target.value)))} /></td>
                  <td>{isRoyal(rank)
                    ? <input aria-label={`${handRankName(rank)} at 5 coins`} inputMode="numeric" value={Number.isNaN(row[4]) ? "" : row[4]} onChange={event => editCell(setCell(draft, rank, 4, numberValue(event.target.value)))} />
                    : <span className="max-pay">{Number.isNaN(row[4]) ? "—" : row[4].toLocaleString("en-US")}</span>}</td>
                </>}
            </tr>;
          })}</tbody>
        </table>
        {unknown.length > 0 && <div className="photo-unknown" role="group" aria-label="Rows to assign">
          <p className="field-label">The photo has rows this game doesn't name. Which hand is each?</p>
          {unknown.map((row, index) => <label key={`${row.label}-${index}`} className="photo-unknown-row">
            <span>“{row.label}” <small>{row.pays.join(" / ")}</small></span>
            <select aria-label={`Hand for “${row.label}”`} value="" onChange={event => { if (event.target.value) assign(index, event.target.value); }}>
              <option value="">Choose a hand… (or ignore)</option>
              {ranks.map(rank => <option key={rank} value={rank}>{handRankName(rank)}</option>)}
            </select>
          </label>)}
        </div>}
      </section>
    </div>

    <aside className="paytable-editor-side">
      {photo && <figure className="photo-compare">
        <img src={photo.imageUrl} alt="Your photo of the pay table" />
        <figcaption>{photo.source}. Compare each highlighted row with the photo before saving.</figcaption>
      </figure>}
      {reading?.multiplierGame && <div className="warning-card" role="note"><strong>{reading.multiplierGame} isn't supported yet.</strong> You can save the base pay table shown here and practice its strategy; the multipliers aren't modeled.</div>}
      <div className="return-card" aria-live="polite">
        <span className="return-label">Return with perfect play</span>
        <strong className="return-value">{errors.length ? "—" : preview ? `${preview.returnPct.toFixed(2)}%` : computing ? <span className="computing"><span className="btn-spinner" aria-hidden="true" />Computing…</span> : "—"}</strong>
        <span className="return-note">{errors.length ? "Fix the highlighted pays to compute the return." : previewError ? `Couldn't compute: ${previewError}` : preview ? `Max bet · hits ${(preview.hitFreq * 100).toFixed(1)}% of hands` : "Computed exactly by the engine, at max bet."}</span>
      </div>
      {match && <p className="editor-message is-ok"><Icon name="check" size={15} />{reading ? "Looks like" : "These pays match"} the built-in {match.name}.</p>}
      {closest && <p className="editor-message is-warn"><Icon name="info" size={15} />Closest built-in: {closest.table.name}, which differs in {closest.differing.map(handRankName).join(", ")}.</p>}
      {issues.length > 0 && <ul className="issue-list">{issues.map((issue, index) => <li key={index} className={`is-${issue.level}`}><Icon name="warning" size={14} />{issue.message}</li>)}</ul>}
      <Field label="Name"><input aria-label="Pay table name" maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder={match?.name ?? suggestedName(draft)} /></Field>
      <div className="form-actions">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={errors.length > 0} loading={busy} loadingLabel="Saving…">{match ? "Use built-in table" : "Save pay table"}</Button>
      </div>
    </aside>
  </form>;
}
