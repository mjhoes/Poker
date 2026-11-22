/** Calendar helpers depend only on explicit inputs, never the host timezone or clock. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function localDay(at: number, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(at);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
/** First instant of a local date, including zones whose DST transition is at midnight. */
export function localDayBounds(day: string, timeZone: string) {
  const ordinal = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(ordinal) || new Date(ordinal).toISOString().slice(0, 10) !== day) throw new Error("Invalid calendar date.");
  const start = (target: string, approximate: number) => {
    let lo = approximate - 36 * 3_600_000, hi = approximate + 36 * 3_600_000;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (localDay(mid, timeZone) < target) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const since = start(day, ordinal);
  if (localDay(since, timeZone) !== day) throw new Error("This date does not exist in the selected timezone.");
  const next = new Date(ordinal + 86_400_000).toISOString().slice(0, 10);
  return { since, until: start(next, ordinal + 86_400_000) - 1 };
}
