import type { GameFamilyId } from "@perfect-draw/engine";
import { PAY_TABLE_LIBRARY } from "@perfect-draw/paytables";
import type { Machine, Session } from "@perfect-draw/shared";
import { STARTER_MACHINES } from "../machines/machine-info";
import type { PaytableInfo } from "../paytables/catalog";

/** Something to analyze against: one of your machines (its table, bet and denomination) or a pay table on its own. */
export interface AnalyzerTarget {
  key: string; kind: "machine" | "table"; paytableId: string; familyId: GameFamilyId; name: string; tableName: string;
  coins: number; denominationCents: number | null;
}

export function buildTargets(machines: readonly Machine[], tables: readonly PaytableInfo[]): AnalyzerTarget[] {
  const byId = new Map(tables.map(table => [table.id, table]));
  const machineTargets = machines.filter(machine => machine.deletedAt == null && byId.has(machine.paytableId)).map(machine => {
    const table = byId.get(machine.paytableId)!;
    return {
      key: `machine:${machine.id}`, kind: "machine" as const, paytableId: table.id, familyId: table.familyId, name: machine.name,
      tableName: table.name, coins: machine.coins, denominationCents: machine.denominationCents,
    };
  });
  const tableTargets = tables.map(table => ({
    key: `table:${table.id}`, kind: "table" as const, paytableId: table.id, familyId: table.familyId, name: table.name,
    tableName: table.name, coins: 5, denominationCents: null,
  }));
  return [...machineTargets, ...tableTargets];
}

/**
 * Where to start: the table a link or recent hand names (`requested`), else the open session's machine, else the last
 * machine played, else 9/6 Jacks. `missing` is true when a table was requested but is not available on this device
 * (deleted, or from another device) — the caller must say so rather than silently show a different table.
 */
export function resolveTarget(targets: readonly AnalyzerTarget[], options: { requested?: boolean; paytableId?: string | null; coins?: number | null; session?: Session; sessions?: readonly Session[] }) {
  if (options.paytableId) {
    const machines = targets.filter(target => target.kind === "machine" && target.paytableId === options.paytableId);
    const found = machines.find(target => target.coins === options.coins) ?? machines[0] ?? targets.find(target => target.key === `table:${options.paytableId}`);
    if (found) return { target: found, missing: false };
  }
  return { target: defaultTarget(targets, options), missing: !!options.requested || !!options.paytableId };
}

function defaultTarget(targets: readonly AnalyzerTarget[], options: { session?: Session; sessions?: readonly Session[] }) {
  const recent = options.session ?? [...(options.sessions ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const fromSession = recent && targets.find(target => target.key === `machine:${recent.machineId}`);
  return fromSession ?? targets.find(target => target.key === `table:${PAY_TABLE_LIBRARY.find(table => table.slug === "jacks-or-better-9-6")!.id}`) ?? targets[0];
}

/** Your machines (each at its bet) and the popular tables at max bet, without repeating a table and bet, minus `exclude`. */
export function acrossTargets(targets: readonly AnalyzerTarget[], exclude: { paytableId: string; coins: number }) {
  const popular = new Set(STARTER_MACHINES.map(starter => PAY_TABLE_LIBRARY.find(table => table.slug === starter.slug)?.id));
  const seen = new Set([`${exclude.paytableId}:${exclude.coins}`]);
  const list: AnalyzerTarget[] = [];
  for (const target of targets) {
    if (target.kind === "table" && !popular.has(target.paytableId)) continue;
    const key = `${target.paytableId}:${target.coins}`;
    if (seen.has(key)) continue;
    seen.add(key); list.push(target);
  }
  return list;
}
