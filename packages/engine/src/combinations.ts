/** Exact integer binomial coefficients for the 52-card deck. */
export function choose(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) return 0;
  let value = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) value = value * (n - i + 1) / i;
  return Math.round(value);
}

export const HAND_COUNT = choose(52, 5);
/** Colexicographic combinadic indexing: Σ C(sortedCards[i], i + 1). */
export const COMBINATIONS = Array.from({ length: 6 }, (_, k) =>
  Float64Array.from({ length: 52 }, (_, n) => choose(n, k)),
);
