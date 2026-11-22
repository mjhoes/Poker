import { getCanonicalHands } from "./canonical";
import type { TrainingContext } from "./training";

interface Option {
  /** Ordered level-0 alternatives, not an EV-selected coarse bucket. */
  labels: string[];
  evs: Float64Array;
}
interface Columns {
  options: Map<string, Option>;
  weights: Float64Array;
  size: number;
}
const cache = new WeakMap<TrainingContext, Columns>();

function columns(context: TrainingContext, baseOrder: readonly string[]): Columns {
  const cached = cache.get(context);
  if (cached) return cached;
  const data = context.getData(), hands = getCanonicalHands(), size = hands.length;
  const bases = new Set(baseOrder), variants = new Map<string, string[]>();
  for (const name of data.names[2]) if (name.includes("|") && bases.has(name.split("|")[0])) {
    const base = name.split("|")[0], group = variants.get(base) ?? [];
    group.push(name); variants.set(base, group);
  }
  const names = [...baseOrder, ...[...variants.values()].filter(group => group.length > 1).flat()];
  const options = new Map(names.map(name => [name, { labels: [name], evs: new Float64Array(size).fill(-Infinity) }]));
  const basic = data.names[0].map(name => options.get(name)?.evs);
  const refined = data.names[2].map(name => options.get(name)?.evs);
  for (let h = 0; h < size; h++) for (let mask = 0; mask < 32; mask++) {
    const index = h * 32 + mask, ev = data.evs[index];
    const a = basic[data.labels[0][index]], b = refined[data.labels[2][index]];
    if (a && ev > a[h]) a[h] = ev;
    if (b && ev > b[h]) b[h] = ev;
  }
  const result = { options, size, weights: Float64Array.from(hands, hand => hand.weight) };
  cache.set(context, result);
  return result;
}

function replay(order: readonly Option[], data: Columns) {
  const ranks = new Uint16Array(data.size), evs = new Float64Array(data.size);
  let total = 0;
  for (let h = 0; h < data.size; h++) {
    let rank = 0;
    while (rank < order.length && !Number.isFinite(order[rank].evs[h])) rank++;
    if (rank === order.length) throw new Error("Chart lacks its DRAW5 fallback.");
    ranks[h] = rank; evs[h] = order[rank].evs[h];
    total += evs[h] * data.weights[h];
  }
  return { ranks, evs, total };
}

function insertion(option: Option, order: readonly Option[], state: ReturnType<typeof replay>, data: Columns) {
  const gains = new Float64Array(order.length);
  for (let h = 0; h < data.size; h++) if (Number.isFinite(option.evs[h])) {
    gains[state.ranks[h]] += (option.evs[h] - state.evs[h]) * data.weights[h];
  }
  let gain = 0, bestGain = -Infinity, position = 0;
  for (let rank = order.length - 1; rank >= 0; rank--) {
    gain += gains[rank];
    if (gain > bestGain + 1e-9) { bestGain = gain; position = rank; }
  }
  return { gain: bestGain, position };
}

function addGreedily(order: Option[], pool: readonly Option[], limit: number, data: Columns): void {
  while (order.length < limit) {
    const state = replay(order, data);
    let best: Option | undefined, gain = 1e-8, position = 0;
    for (const option of pool) if (!order.includes(option)) {
      const choice = insertion(option, order, state, data);
      if (choice.gain > gain) { best = option; gain = choice.gain; position = choice.position; }
    }
    if (!best) break;
    order.splice(position, 0, best);
  }
}

/** Coordinate descent: every accepted move increases this chart's own return. */
function improve(order: Option[], data: Columns): void {
  for (let pass = 0; pass < 3; pass++) {
    let changed = false, total = replay(order, data).total;
    for (const option of [...order.slice(0, -1)]) {
      const previous = order.indexOf(option), reduced = order.filter(item => item !== option);
      const state = replay(reduced, data), choice = insertion(option, reduced, state, data);
      if (state.total + choice.gain > total + 1e-7) {
        order.splice(previous, 1); order.splice(choice.position, 0, option);
        total = state.total + choice.gain; changed = true;
      }
    }
    if (!changed) break;
  }
}

function beginnerGroup(label: string): string {
  const prefix = label.match(/^D\d_/)?.[0] ?? "", base = label.slice(prefix.length);
  const kind = /^(RF|SF|4K.*|FH|4D|WRF|5K)$/.test(base) ||
    ((!prefix || prefix === "D0_") && /^(3K|2P)$/.test(base)) ? "premium"
    : /^(FL|ST)$/.test(base) ? "made"
    : /^4SF_/.test(base) ? "4SF"
    : /^3RF_/.test(base) ? "3RF"
    : /^4ST_open_/.test(base) ? "4ST_open"
    : /^1H_/.test(base) ? "single_high"
    : /^2RF_.*T/.test(base) ? "suited_ten"
    : /^2RF_/.test(base) ? "suited_high"
    : /_unsuited$/.test(base) ? "unsuited_high"
    : base;
  return prefix + kind;
}

export function boundedChart(context: TrainingContext, tier: "Beginner" | "Expert", baseOrder: readonly string[]) {
  const data = columns(context, baseOrder), fallback = data.options.get(baseOrder.at(-1)!)!;
  if (tier === "Beginner") {
    const grouped = new Map<string, string[]>();
    for (const label of baseOrder.slice(0, -1)) {
      const key = beginnerGroup(label), group = grouped.get(key) ?? [];
      group.push(label); grouped.set(key, group);
    }
    const pool: Option[] = [...grouped.values()].map(labels => {
      const evs = new Float64Array(data.size).fill(-Infinity);
      for (const label of labels) {
        const column = data.options.get(label)!.evs;
        for (let h = 0; h < data.size; h++) if (!Number.isFinite(evs[h])) evs[h] = column[h];
      }
      return { labels, evs };
    });
    const order = [fallback];
    addGreedily(order, pool, 15, data); improve(order, data);
    return { groups: order.map(option => option.labels), refinement: 0 as const };
  }
  const order = baseOrder.map(label => data.options.get(label)!);
  // Prune by replayed omission cost, never by rarity or an optimal-play proxy.
  while (order.length > 60) {
    let remove = -1, best = -Infinity;
    for (let i = 0; i < order.length - 1; i++) {
      const total = replay(order.filter((_, index) => index !== i), data).total;
      if (total > best) { best = total; remove = i; }
    }
    order.splice(remove, 1);
  }
  improve(order, data);
  const penalties = [...data.options.values()].filter(option => option.labels[0].includes("|pen:"));
  // A penalty-specific line also counts against the 15-exception budget.
  const baseCount = order.length;
  addGreedily(order, penalties, Math.min(60, baseCount + 15), data);
  improve(order, data);
  for (const option of [...order]) if (option.labels[0].includes("|pen:")) {
    const reduced = order.filter(item => item !== option);
    if (replay(reduced, data).total >= replay(order, data).total - 1e-8) order.splice(order.indexOf(option), 1);
  }
  return { groups: order.map(option => option.labels), refinement: 2 as const };
}
