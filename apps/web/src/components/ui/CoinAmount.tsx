import { money } from "../UiHelpers";

const credits = (value: number, digits: number) => {
  if (digits === 0) return Math.round(value).toLocaleString("en-US");
  if (value !== 0 && Math.abs(value) < 10 ** -digits) return value.toExponential(1);
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

/** Dollar value of a credit amount. Sub-cent amounts read "<$0.01" rather than rounding to a misleading $0.00. */
export function dollarsFor(amount: number, denominationCents: number) {
  const cents = amount * denominationCents;
  if (cents !== 0 && Math.abs(cents) < 0.5) return `${cents < 0 ? "−" : ""}<$0.01`;
  return money(Math.round(cents));
}

/** Plain-text form for labels, titles and aria text: "2.470 credits ($0.62)". */
export function formatCoins(amount: number, denominationCents: number, { digits = 0, unit = "credits" }: { digits?: number; unit?: string } = {}) {
  return `${credits(amount, digits)} ${unit} (${dollarsFor(amount, denominationCents)})`;
}

/**
 * Every credit amount appears with its dollar value. Credits are the machine's unit (one credit = one coin at the
 * machine's denomination); the dollar part is set slightly quieter so the two never compete.
 */
export function CoinAmount({ amount, denominationCents, digits = 0, unit = "credits", signed = false }: {
  amount: number; denominationCents: number; digits?: number; unit?: string; signed?: boolean;
}) {
  const sign = signed && amount > 0 ? "+" : signed && amount < 0 ? "−" : "";
  const magnitude = signed ? Math.abs(amount) : amount;
  return <span className="coin-amount">
    <span className="coin-amount-credits">{sign}{credits(magnitude, digits)}{unit ? ` ${unit}` : ""}</span>
    <span className="coin-amount-dollars">({sign}{dollarsFor(magnitude, denominationCents)})</span>
  </span>;
}
