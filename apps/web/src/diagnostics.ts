/**
 * Acknowledgments for outcomes that leave nothing on screen (a late reply that was dropped, a superseded photo, the
 * recent-hands save firing). Each is counted in `window.__perfectDrawSignals`, which tests read instead of sleeping; a
 * plain counter rather than performance marks alone, because test clocks stub the performance timeline. The mark is
 * kept for the browser's performance tools. Harmless in production.
 */
type SignalName = "photo:read-dropped" | "photo:prepare-dropped" | "explain:reply-dropped" | "analyzer:recent-saved";

const counts: Partial<Record<SignalName, number>> = {};
(globalThis as { __perfectDrawSignals?: typeof counts }).__perfectDrawSignals = counts;

export function signal(name: SignalName) {
  counts[name] = (counts[name] ?? 0) + 1;
  try { performance.mark(name); } catch { /* no performance timeline */ }
}
