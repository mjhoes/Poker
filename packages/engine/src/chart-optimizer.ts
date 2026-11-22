import { getCanonicalHands } from "./canonical";
import type { TrainingContext } from "./training";
import { deuceSection } from "./chart-sections";
import { strategyTarget } from "./strategy-targets";

interface Option {
  /** Ordered level-0 alternatives, not an EV-selected coarse bucket. */
  labels: string[];
  evs: Float64Array;
}
interface Columns {
  options: Map<string, Option>;
  weights: Float64Array;
  size: number;
  sectioned: boolean;
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
  const masks = new Map([...options.values()].map(option => [option.evs, new Uint8Array(size).fill(255)]));
  for (let h = 0; h < size; h++) for (let mask = 0; mask < 32; mask++) {
    const index = h * 32 + mask, ev = data.evs[index];
    const a = basic[data.labels[0][index]], b = refined[data.labels[2][index]];
    for (const column of [a, b]) if (column) {
      const selected = masks.get(column)!;
      if (selected[h] === 255 || data.preferences[index] > data.preferences[h * 32 + selected[h]]) {
        selected[h] = mask; column[h] = ev;
      }
    }
  }
  const result = { options, size, weights: Float64Array.from(hands, hand => hand.weight), sectioned: context.analysis.familyId === "deuces_wild" };
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

function omissionLosses(order: readonly Option[], data: Columns): Float64Array {
  const losses = new Float64Array(order.length);
  for (let h = 0; h < data.size; h++) {
    let first = 0;
    while (!Number.isFinite(order[first].evs[h])) first++;
    if (first === order.length - 1) continue;
    let next = first + 1;
    while (!Number.isFinite(order[next].evs[h])) next++;
    losses[first] += (order[first].evs[h] - order[next].evs[h]) * data.weights[h];
  }
  return losses;
}

function insertion(option: Option, order: readonly Option[], state: ReturnType<typeof replay>, data: Columns) {
  const gains = new Float64Array(order.length);
  for (let h = 0; h < data.size; h++) if (Number.isFinite(option.evs[h])) {
    gains[state.ranks[h]] += (option.evs[h] - state.evs[h]) * data.weights[h];
  }
  let gain = 0, bestGain = -Infinity, position = 0;
  for (let rank = order.length - 1; rank >= 0; rank--) {
    gain += gains[rank];
    if (data.sectioned) {
      const section = deuceSection(option.labels[0]);
      if (order.slice(0, rank).some(item => deuceSection(item.labels[0]) > section) ||
          order.slice(rank).some(item => deuceSection(item.labels[0]) < section)) continue;
    }
    if (gain > bestGain + 1e-9) { bestGain = gain; position = rank; }
  }
  return { gain: bestGain, position };
}

function addGreedily(order: Option[], pool: readonly Option[], limit: number, data: Columns): void {
  while (order.length < limit) {
    const state = replay(order, data);
    const used = new Set(order.flatMap(option => option.labels));
    let best: Option | undefined, gain = 1e-8, position = 0;
    for (const option of pool) if (!option.labels.some(label => used.has(label))) {
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

/** Replace early greedy choices whose marginal value changed after later insertions. */
function exchange(order: Option[], pool: readonly Option[], data: Columns, maxCandidates = Infinity): void {
  for (let pass = 0; pass < 3; pass++) {
    let changed = false, total = replay(order, data).total;
    const losses = omissionLosses(order, data);
    const removable = order.slice(0, -1).sort((a, b) => losses[order.indexOf(a)] - losses[order.indexOf(b)])
      .slice(0, maxCandidates);
    for (const previous of removable) {
      const reduced = order.filter(option => option !== previous), state = replay(reduced, data);
      const used = new Set(reduced.flatMap(option => option.labels));
      const exceptions = reduced.filter(option => option.labels[0].includes("|pen:")).length;
      let best: Option | undefined, position = 0, bestTotal = total;
      for (const option of pool) {
        if (option.labels.some(label => used.has(label)) || exceptions >= 15 && option.labels[0].includes("|pen:")) continue;
        const choice = insertion(option, reduced, state, data);
        if (state.total + choice.gain > bestTotal + 1e-7) { best = option; position = choice.position; bestTotal = state.total + choice.gain; }
      }
      if (best) {
        order.splice(order.indexOf(previous), 1); order.splice(position, 0, best);
        total = bestTotal; changed = true;
      }
    }
    if (!changed) break;
  }
}

function beginnerGroup(label: string): string {
  const prefix = label.match(/^D\d_/)?.[0] ?? "", base = label.slice(prefix.length);
  if (prefix === "D3_") return "D3_section";
  const kind = /^(RF|SF|WRF)$/.test(base) || /^4RF(?:_|$)/.test(base) ? "royal_sf_or_4RF"
    : /^(4K.*|FH|4D|5K|FL|ST)$/.test(base) ||
      ((!prefix || prefix === "D0_") && /^(3K(?:_.*)?|2P)$/.test(base)) ? "made"
    : /^4SF_/.test(base) ? "4SF"
    : /^3RF_/.test(base) ? "3RF"
    : /^4ST_open_/.test(base) || prefix && /^4ST_g.*_w[2-9]_/.test(base) ? "4ST_open"
    : /^4ST_inside_/.test(base) || prefix && /^4ST_g/.test(base) ? "4ST_inside"
    : /^LP(?:_|$)/.test(base) ? "low_pair"
    : prefix && /^HP(?:_|$)/.test(base) ? "low_pair"
    : /^HP(?:_|$)/.test(base) ? "high_pair"
    : prefix && /^3SF_/.test(base) ? "3SF"
    : prefix && /^2SF_/.test(base) ? "2SF"
    : prefix && /^3FL_/.test(base) ? "3FL"
    : prefix && /^3ST_/.test(base) ? "3ST"
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
    // Also offer a compact made-hand / four-card SF block. Its explicit
    // subrules retain the learned order (important for wild flushes/straights).
    // Keeping the separate groups too lets measured induction choose either.
    for (const prefix of new Set(baseOrder.map(label => label.match(/^D\d_/)?.[0] ?? ""))) {
      if (!grouped.has(prefix + "made") || !grouped.has(prefix + "4SF")) continue;
      grouped.set(prefix + "made_or_4SF", baseOrder.filter(label => {
        const key = beginnerGroup(label);
        return key === prefix + "made" || key === prefix + "4SF";
      }));
    }
    const pool: Option[] = [], seen = new Set<string>();
    const add = (labels: string[]) => {
      const key = labels.join(" / ");
      if (seen.has(key)) return;
      seen.add(key);
      if (labels.length === 1) { pool.push(data.options.get(labels[0])!); return; }
      const evs = new Float64Array(data.size).fill(-Infinity);
      for (const label of labels) {
        const column = data.options.get(label)!.evs;
        for (let h = 0; h < data.size; h++) if (!Number.isFinite(evs[h])) evs[h] = column[h];
      }
      pool.push({ labels, evs });
    };
    for (const labels of grouped.values()) {
      // A chart line may name only the useful portion of a draw category.
      // Prefix/suffix options also allow two explicit, disjoint strength bands.
      for (let size = 1; size <= labels.length; size++) {
        add(labels.slice(0, size)); add(labels.slice(labels.length - size));
      }
      for (const label of labels) add([label]);
    }
    const order = [fallback];
    addGreedily(order, pool, strategyTarget(tier, context.analysis.familyId).maxLines, data); improve(order, data);
    exchange(order, pool, data); improve(order, data);
    return { groups: order.map(option => option.labels), refinement: 0 as const };
  }
  const order = baseOrder.map(label => data.options.get(label)!);
  // Prune by replayed omission cost, never by rarity or an optimal-play proxy.
  const limit = strategyTarget(tier, context.analysis.familyId).maxLines;
  while (order.length > limit) {
    const losses = omissionLosses(order, data);
    let remove = 0;
    for (let i = 1; i < order.length - 1; i++) if (losses[i] < losses[remove]) remove = i;
    order.splice(remove, 1);
  }
  improve(order, data);
  const penalties = [...data.options.values()].filter(option => option.labels[0].includes("|pen:"));
  // A penalty-specific line also counts against the 15-exception budget.
  const baseCount = order.length;
  addGreedily(order, penalties, Math.min(limit, baseCount + 15), data);
  improve(order, data);
  if (context.analysis.returnPct - replay(order, data).total / 2598960 * 100 / context.analysis.betCoins > 0.03) {
    exchange(order, [...data.options.values()].filter(option => option !== fallback), data, 15); improve(order, data);
  }
  for (const option of [...order]) if (option.labels[0].includes("|pen:")) {
    const reduced = order.filter(item => item !== option);
    if (replay(reduced, data).total >= replay(order, data).total - 1e-8) order.splice(order.indexOf(option), 1);
  }
  return { groups: order.map(option => option.labels), refinement: 2 as const };
}
