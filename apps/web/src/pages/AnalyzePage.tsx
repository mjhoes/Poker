import { useEffect, useMemo, useRef, useState } from "react";
import type { Hand, HandAnalysis } from "@perfect-draw/engine";
import type { Machine, RecentHand, Session } from "@perfect-draw/shared";
import { Button, ChoiceChips } from "../components/ui";
import { familyName, Modal } from "../components/UiHelpers";
import { formatCost, modelInfo } from "../ai/models";
import type { Run } from "../hooks/useActionRunner";
import { PhotoReader } from "../photo/PhotoReader";
import { PayTablePhotoFlow } from "../photo/PayTablePhotoFlow";
import { readHand } from "../photo/hand-photo";
import type { HandReply } from "../photo/hand-photo";
import type { PreparedImage } from "../photo/image";
import { announceSave } from "../dialogs/PayTableDialogs";
import { dollarsFor } from "../components/ui";
import { errorMessage } from "../hooks/useActionRunner";
import { useAllPaytables } from "../paytables/catalog";
import { preferencesService } from "../services/preferences";
import { useAppStore } from "../state/app-store";
import { shortBetNote } from "../table/BetControls";
import { CardFace } from "../table/CardFace";
import { cardName, maskIndexes, shortCard } from "../table/cards";
import { gradeLabel } from "../table/Feedback";
import { HoldComparisonPanel, runnerUpMask } from "../table/HoldComparison";
import { engineClient } from "../worker/client";
import { AcrossPanel, RecentHands, StrategyPanel } from "../analyzer/AnalyzerPanels";
import { CardPicker } from "../analyzer/CardPicker";
import { decodeAnalyzerQuery, encodeAnalyzerQuery, handText, randomHand, readHandText } from "../analyzer/hand-input";
import { rankHolds } from "../analyzer/ranked-holds";
import { acrossTargets, buildTargets, resolveTarget } from "../analyzer/targets";
import type { AnalyzerTarget } from "../analyzer/targets";

const SHOWN_HOLDS = 8;

/**
 * The Hand Analyzer: any five cards on any table and bet, every hold ranked by the engine, why one hold beats another,
 * the strategy-chart line, and whether the answer changes on other tables. The address keeps the hand, table and bet.
 */
export function AnalyzePage({ search, replaceSearch, machines, sessions, activeSession, busy, run }: {
  search: string; replaceSearch: (search: string) => void; machines: Machine[]; sessions: Session[]; activeSession?: Session;
  busy: boolean; run: Run;
}) {
  const tables = useAllPaytables();
  const recentHands = useAppStore(state => state.recentHands);
  const targets = useMemo(() => buildTargets(machines, tables), [machines, tables]);
  const initial = useMemo(() => decodeAnalyzerQuery(search), []); // eslint-disable-line react-hooks/exhaustive-deps
  const resolved = useMemo(() => resolveTarget(targets, { requested: initial.tableRequested, paytableId: initial.paytableId, coins: initial.coins, session: activeSession, sessions }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = targets.find(item => item.key === resolved.target?.key) ?? resolveTarget(targets, { session: activeSession, sessions }).target;

  const [cards, setCards] = useState<number[]>(initial.hand ?? []);
  const [text, setText] = useState(initial.hand ? handText(initial.hand) : "");
  const [textError, setTextError] = useState<string | null>(null);
  /** The parser's own verdict: exactly five valid cards and nothing left over (an unfinished sixth card is not complete). */
  const [textComplete, setTextComplete] = useState(!!initial.hand);
  const [targetKey, setTargetKey] = useState(start?.key ?? "");
  const [coins, setCoins] = useState(initial.coins ?? start?.coins ?? 5);
  const [held, setHeld] = useState<number | null>(initial.held);
  const [marking, setMarking] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [computed, setComputed] = useState<{ key: string; value: HandAnalysis } | null>(null);
  const [error, setError] = useState("");
  /** Set when a link or recent hand named a table this device doesn't have: we say which table is shown instead. */
  const [missingTable, setMissingTable] = useState(resolved.missing);
  const written = useRef(search);

  const target = targets.find(item => item.key === targetKey) ?? start;
  // Five cards from valid input only: text with an error (six cards, a typo) is never analyzed, saved or put in the address.
  const complete = cards.length === 5 && textComplete && !textError;
  const handKey = cards.join(",");
  const denomination = target?.denominationCents ?? null;
  // Only an analysis of exactly these cards, table and bet is shown (never a stale one for a moment).
  const analysisKey = complete && target ? `${handKey}|${target.paytableId}|${coins}` : "";
  const analysis = computed && computed.key === analysisKey ? computed.value : null;

  // Opened again from elsewhere (a link or a recent hand) while already on this page: load what the address says.
  useEffect(() => {
    if (search === written.current) return;
    written.current = search;
    const next = decodeAnalyzerQuery(search);
    if (!next.hand) return;
    const { target: nextTarget, missing } = resolveTarget(targets, { requested: next.tableRequested, paytableId: next.paytableId, coins: next.coins });
    setCards(next.hand); setText(handText(next.hand)); setTextError(null); setTextComplete(true); setHeld(next.held); setMarking(false); setSelected(null);
    showTarget(nextTarget, next.coins, missing);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the address in step with the hand, so a reload or bookmark reopens it.
  useEffect(() => {
    const next = complete && target ? encodeAnalyzerQuery({ hand: cards, paytableId: target.paytableId, coins, held }) : "";
    if (next === written.current) return;
    written.current = next;
    replaceSearch(next);
  }, [complete, handKey, target?.paytableId, coins, held]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setError("");
    if (!analysisKey || !target) return;
    let cancelled = false;
    engineClient().analyzeHand(cards as unknown as Hand, target.paytableId, coins)
      .then(value => { if (!cancelled) setComputed({ key: analysisKey, value }); })
      .catch(reason => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, [analysisKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key covers validity, cards, table and bet

  // A hand that stays on screen for a moment goes into Recent hands.
  useEffect(() => {
    if (!analysis || !target) return;
    const timer = setTimeout(() => { void preferencesService.addRecentHand({ hand: cards, paytableId: target.paytableId, coins }).catch(() => undefined); }, 800);
    return () => clearTimeout(timer);
  }, [analysis]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hand photos: the dialog, cards the reading wasn't sure of, and (in memory only) a photo that also shows a pay table.
  const [photoOpen, setPhotoOpen] = useState(false);
  const [doubtful, setDoubtful] = useState<number[]>([]);
  const [photoNote, setPhotoNote] = useState("");
  const [tablePhoto, setTablePhoto] = useState<PreparedImage | null>(null);
  const [tablePhotoOpen, setTablePhotoOpen] = useState(false);
  const dropTablePhoto = () => { setTablePhoto(current => { if (current) URL.revokeObjectURL(current.previewUrl); return null; }); setTablePhotoOpen(false); };
  const changeCards = (next: number[]) => {
    setDoubtful([]); setPhotoNote("");
    setCards(next); setText(handText(next)); setTextError(null); setTextComplete(next.length === 5); setHeld(null); setMarking(false); setSelected(null); setShowAll(false);
  };
  const onType = (value: string) => {
    setText(value);
    const read = readHandText(value);
    setTextError(read.error); setTextComplete(read.complete);
    if (read.cards.join(",") !== handKey) { setDoubtful([]); setPhotoNote(""); setCards(read.cards); setHeld(null); setMarking(false); setSelected(null); setShowAll(false); }
  };
  const toggleCard = (card: number) => changeCards(cards.includes(card) ? cards.filter(item => item !== card) : [...cards, card].slice(0, 5));
  function showTarget(next: AnalyzerTarget | undefined, nextCoins: number | null, missing: boolean) {
    if (next) { setTargetKey(next.key); setCoins(nextCoins ?? next.coins); }
    setMissingTable(missing);
  }
  const chooseTarget = (key: string) => {
    const next = targets.find(item => item.key === key);
    if (!next) return;
    setTargetKey(key); setCoins(next.coins); setSelected(null); setMissingTable(false);
  };
  const openRecent = (hand: RecentHand) => {
    const { target: nextTarget, missing } = resolveTarget(targets, { requested: true, paytableId: hand.paytableId, coins: hand.coins });
    changeCards([...hand.hand]);
    showTarget(nextTarget, hand.coins, missing);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  /** Changing what was held shows the comparison for the new hold, not a hold picked from the list earlier. */
  const changeHeld = (next: number | null) => { setHeld(next); setSelected(null); };

  const ranked = analysis ? rankHolds(analysis.results, coins) : null;
  const best = ranked?.rows[0];
  const runnerUp = analysis && best ? runnerUpMask(analysis.results, best.mask) : null;
  const compared = selected ?? held ?? runnerUp;
  const mine = held === null || !ranked ? null : ranked.rows.find(row => row.mask === held) ?? null;
  const visible = ranked ? (showAll ? ranked.rows : ranked.rows.slice(0, SHOWN_HOLDS)) : [];
  const heldText = (mask: number) => maskIndexes(mask).map(index => shortCard(cards[index])).join(" ") || "Draw five";
  const value = (amount: number) => <>{amount.toFixed(3)}{denomination !== null && <span className="analyzer-dollars"> {dollarsFor(amount, denomination)}</span>}</>;
  const groups = useMemo(() => {
    const byFamily = new Map<string, typeof targets>();
    for (const item of targets.filter(item => item.kind === "table")) byFamily.set(item.familyId, [...(byFamily.get(item.familyId) ?? []), item]);
    return [...byFamily.entries()];
  }, [targets]);
  const across = target ? acrossTargets(targets, { paytableId: target.paytableId, coins }) : [];
  const betNote = target ? shortBetNote(target.paytableId, coins) : null;

  return <div className="analyzer-page">
    <div className="page-heading">
      <div><p className="eyebrow">HAND ANALYZER</p><h1>Analyze a hand</h1><p className="analyzer-subtitle">Any five cards, any table: every hold ranked by the engine, and why.</p></div>
    </div>

    <div className="analyzer-layout">
      <div className="analyzer-main">
        <section className="panel panel-pad analyzer-entry" aria-label="Hand">
          <div className={`analyzer-hand ${marking ? "is-marking" : ""}`} role="group" aria-label={marking ? "Tap the cards you kept" : "Your hand"}>
            {[0, 1, 2, 3, 4].map(index => {
              const card = cards[index];
              if (card === undefined) return <span key={`empty-${index}`} className="analyzer-slot is-empty" aria-hidden="true"><span>{index + 1}</span></span>;
              const kept = held !== null && (held & (1 << index)) !== 0;
              const inBest = !!best && !marking && (best.mask & (1 << index)) !== 0;
              return <button key={`${card}-${index}`} type="button"
                className={`analyzer-slot ${inBest ? "is-best" : ""} ${marking ? (kept ? "is-kept" : "is-dropped") : ""} ${doubtful.includes(index) ? "is-doubtful" : ""}`}
                aria-label={marking ? `${cardName(card)}, ${kept ? "kept" : "not kept"}` : `${cardName(card)}. Remove`}
                aria-pressed={marking ? kept : undefined}
                onClick={() => marking ? changeHeld((held ?? 0) ^ (1 << index)) : changeCards(cards.filter((_, position) => position !== index))}>
                <CardFace card={card} />
                {marking && kept && <span className="slot-tag">Kept</span>}
                {inBest && <span className="slot-tag is-best">Best</span>}
              </button>;
            })}
          </div>

          <div className="analyzer-controls">
            <label className="field analyzer-text">
              <span className="field-label">Type a hand</span>
              <input aria-label="Type a hand" value={text} onChange={event => onType(event.target.value)} placeholder="As Ks Qd 7c 2h"
                autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={!!textError} aria-describedby="hand-text-help" />
            </label>
            <div className="analyzer-buttons">
              <Button variant="secondary" icon="camera" onClick={() => setPhotoOpen(true)}>From a photo</Button>
              <Button variant="secondary" icon="cards" onClick={() => changeCards(randomHand())}>Random hand</Button>
              <Button variant="secondary" disabled={!cards.length} onClick={() => changeCards([])}>Clear</Button>
            </div>
          </div>
          <p id="hand-text-help" className={`analyzer-help ${textError ? "is-error" : ""}`} role={textError ? "alert" : undefined}>
            {textError ?? "Rank then suit: A K Q J 10 (or T) … 2, and c d h s. Or pick cards below."}
          </p>

          {photoNote && <p className="analyzer-photo-note" role="status">{photoNote}</p>}
          {tablePhoto && <div className="analyzer-photo-table" role="group" aria-label="Pay table in the photo">
            <span>The photo also shows a pay table. Read it too, to analyze this hand on that exact table?</span>
            <Button variant="secondary" size="sm" icon="camera" onClick={() => setTablePhotoOpen(true)}>Read the pay table…</Button>
            <button type="button" className="link-button" onClick={dropTablePhoto}>No thanks</button>
          </div>}
          {!marking && <CardPicker cards={cards} onToggle={toggleCard} />}

          <div className="analyzer-table">
            <label className="field analyzer-select">
              <span className="field-label">Machine or pay table</span>
              <select aria-label="Machine or pay table" value={target?.key ?? ""} onChange={event => chooseTarget(event.target.value)}>
                {targets.some(item => item.kind === "machine") && <optgroup label="Your machines">
                  {targets.filter(item => item.kind === "machine").map(item => <option key={item.key} value={item.key}>{item.name} — {item.tableName}</option>)}
                </optgroup>}
                {groups.map(([familyId, items]) => <optgroup key={familyId} label={familyName(familyId)}>
                  {items.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
                </optgroup>)}
              </select>
            </label>
            <ChoiceChips label="Bet (coins per line)" value={String(coins)} onChange={next => { setCoins(Number(next)); setSelected(null); }}
              choices={["1", "2", "3", "4", "5"].map(choice => ({ value: choice, label: choice, name: `${choice} coin${choice === "1" ? "" : "s"}` }))} />
          </div>
          {betNote && <p className="bet-note analyzer-bet-note">{betNote}</p>}
          {missingTable && target && <p className="analyzer-missing" role="alert">The pay table in that link or recent hand isn't on this device (it may have been deleted). Showing <strong>{target.name}</strong> at {coins} coin{coins === 1 ? "" : "s"} instead; choose another table above.</p>}
        </section>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {!complete && <section className="panel panel-pad analyzer-empty">{textError
          ? <><p className="eyebrow">CHECK THE HAND</p><h2>Fix the hand above to see every hold ranked.</h2></>
          : cards.length === 5 ? <><p className="eyebrow">MORE THAN FIVE CARDS</p><h2>A hand has five cards. Remove the extra one to see every hold ranked.</h2></>
          : <><p className="eyebrow">{5 - cards.length} CARD{5 - cards.length === 1 ? "" : "S"} TO GO</p><h2>Pick five cards to see every hold ranked.</h2></>}</section>}

        {ranked && best && analysis && <section className="panel panel-pad analyzer-results" aria-label="Holds ranked">
          <div className="analyzer-results-head">
            <div>
              <p className="eyebrow">BEST HOLD{ranked.bestCount > 1 ? `S · ${ranked.bestCount} EQUAL` : ""}</p>
              <h2>{heldText(best.mask)} <span className="analyzer-best-label">· {gradeLabel(best.label, analysis.familyId)}</span></h2>
              <p className="analyzer-best-value">{value(best.ev)} credits per line</p>
            </div>
            <div className="analyzer-mine">
              {marking ? <><p>Tap the cards you kept, then press Done.</p><div className="analyzer-buttons">
                <Button variant="secondary" size="sm" onClick={() => setMarking(false)}>Done</Button>
                <Button variant="secondary" size="sm" onClick={() => { changeHeld(null); setMarking(false); }}>Remove</Button></div></>
                : mine ? <><p>{mine.best ? <>What you held <strong>is a best hold</strong>.</> : <>What you held costs <strong>{value(mine.behind)}</strong> credits per line.</>}</p>
                  <button type="button" className="link-button" onClick={() => { setMarking(true); setSelected(null); }}>Change what I held</button></>
                : <Button variant="secondary" size="sm" onClick={() => { setHeld(held ?? 0); setMarking(true); setSelected(null); }}>What I held…</Button>}
            </div>
          </div>
          {ranked.closeCall && <p className="analyzer-close-call" role="note">Close call: the next hold ({heldText(ranked.closeCall.mask)}) is only {ranked.closeCall.gap.toFixed(3)} credits behind.</p>}

          <ol className="hold-list" aria-label="All holds, best first">
            {visible.map(row => <li key={row.mask}>
              <button type="button" className={`hold-row ${compared === row.mask ? "is-selected" : ""} ${row.best ? "is-best" : ""}`}
                aria-pressed={compared === row.mask} onClick={() => setSelected(row.mask)}>
                <span className="hold-rank">{row.rank}</span>
                <span className="hold-cards" aria-label={`Hold ${heldText(row.mask)}`}>
                  {cards.map((card, index) => <span key={card} className={`mini-card ${(row.mask & (1 << index)) ? "is-held" : "is-dropped"}`}><CardFace card={card} variant="compact" /></span>)}
                </span>
                <span className="hold-name">{gradeLabel(row.label, analysis.familyId)}
                  {row.best && <span className="hold-badge">Best</span>}{held === row.mask && <span className="hold-badge is-mine">Yours</span>}</span>
                <span className="hold-ev">{row.ev.toFixed(3)}</span>
                <span className="hold-behind">{row.best ? "—" : `−${row.behind.toFixed(3)}`}</span>
              </button>
            </li>)}
          </ol>
          {ranked.rows.length > SHOWN_HOLDS && <button type="button" className="link-button analyzer-show-all" onClick={() => setShowAll(!showAll)}>
            {showAll ? `Show the top ${SHOWN_HOLDS}` : `Show all ${ranked.rows.length} holds`}</button>}
          <p className="analyzer-note">Expected value in credits per line at {coins} coin{coins === 1 ? "" : "s"}{denomination !== null ? `, with dollars at ${target?.name}'s denomination` : ""}. Select a hold to see why the best hold beats it.</p>

          {compared !== null && <div className="analyzer-why">
            <h3>{compared === best.mask ? "Best hold" : `Why the best hold beats ${held === compared ? "what you held" : heldText(compared)}`}</h3>
            <HoldComparisonPanel analysis={{ ...analysis, hand: cards }} bestMask={best.mask} other={compared} onOther={setSelected}
              mine={held} denominationCents={denomination} explore={false} context={target ? { paytableId: target.paytableId, coins } : undefined} />
          </div>}
        </section>}
      </div>

      <aside className="analyzer-side">
        {ranked && best && target && <StrategyPanel cards={cards} paytableId={target.paytableId} coins={coins} bestMask={best.mask} bestEv={best.ev} onShow={setSelected} />}
        {ranked && best && <AcrossPanel cards={cards} bestMask={best.mask} targets={across} />}
        <RecentHands hands={recentHands} onOpen={openRecent} onClear={() => void preferencesService.clearRecentHands()} />
      </aside>
    </div>

    {photoOpen && <Modal className="photo-sheet" title="Hand from a photo" subtitle="The AI reads the five cards; you can correct any card before relying on the answer." onClose={() => setPhotoOpen(false)}>
      <PhotoReader kind="hand" onRead={result => {
        let reading;
        try { reading = readHand(result.reply as HandReply); }
        catch (reason) { setPhotoNote(errorMessage(reason)); setPhotoOpen(false); URL.revokeObjectURL(result.image.previewUrl); return; }
        changeCards(reading.cards);
        if (reading.heldMask !== null) setHeld(reading.heldMask);
        setDoubtful(reading.doubtful);
        const source = `Read by ${modelInfo(result.model)?.name ?? result.model}${result.cached ? " (from this device, no new cost)" : ` · ${formatCost(result.cost)}`}`;
        setPhotoNote(`${source}.${reading.doubtful.length ? " Outlined cards were hard to read; tap one to remove it, then pick the right card." : ""}${reading.heldMask !== null ? " The HELD cards are shown as what you held." : ""}`);
        dropTablePhoto();
        if (reading.payTableVisible) setTablePhoto(result.image); else URL.revokeObjectURL(result.image.previewUrl);
        setPhotoOpen(false);
      }} />
    </Modal>}
    {tablePhotoOpen && tablePhoto && <Modal className="paytable-sheet" title="Pay table from the same photo" subtitle="A second, separate read. Confirm the pays before using them." onClose={() => setTablePhotoOpen(false)}>
      <PayTablePhotoFlow busy={busy} run={run} initialImage={tablePhoto} doneLabel="Analyze on this table" onCancel={() => setTablePhotoOpen(false)} onSaved={announceSave}
        onDone={result => { setTargetKey(`table:${result.id}`); setCoins(5); setMissingTable(false); setTablePhoto(null); setTablePhotoOpen(false); }} />
    </Modal>}
  </div>;
}
