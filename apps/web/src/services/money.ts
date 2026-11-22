/** Parse decimal dollars as integer cents without a floating-point dollar multiplication. */
export function parseCents(input: string, allowZero = false): number | null {
  const trimmed = input.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0) ? value : null;
}
