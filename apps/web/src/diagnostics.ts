/**
 * Named marks in the browser's performance timeline for outcomes that leave nothing on screen (a late reply that was
 * dropped, a superseded photo). Harmless in production; tests wait for them instead of sleeping.
 */
export function signal(name: "photo:read-dropped" | "photo:prepare-dropped" | "explain:reply-dropped" | "analyzer:recent-saved") {
  try { performance.mark(name); } catch { /* no performance timeline */ }
}
