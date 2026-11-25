import type { Records } from "@perfect-draw/shared";

/*
 * The cruise tracker's arithmetic, kept pure so every figure is unit-tested. Only readings are stored (cash, points
 * on the machine, hands, time); coin-in, points earned and costs are derived here on every read, so editing a
 * program's rules recalculates the whole history. Money is in cents; returns are percentages (99.54 = 99.54%).
 */

export type Program = Records["rewardsPrograms"];
export type Trip = Records["trips"];
export type CasinoSession = Records["casinoSessions"];
export type Reward = Records["rewardsReceived"];

export const HOUR_MS = 3_600_000;
export const DEFAULT_HANDS_PER_HOUR = 600;
/** Practice gaps longer than this count as a break, not play. */
export const PRACTICE_IDLE_MS = 60_000;
/** Below this many practice decisions on a pay table, costs use perfect play (and say so). */
export const MIN_DECISIONS_FOR_ERROR_COST = 200;
/** Per-hour rates are shown only after this much active play. */
export const MIN_RATE_MS = 10 * 60_000;

export const betCents = (session: Pick<CasinoSession, "denominationCents" | "coins" | "lines">) => session.denominationCents * session.coins * session.lines;
const pointCents = (program: Program) => Math.round(program.dollarsPerPoint * 100);

/** Active play time: every segment's length; the open segment (if playing) runs until `now`. */
export function activeMs(session: Pick<CasinoSession, "timeSegments" | "endedAt">, now = Date.now()) {
  return session.timeSegments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? (session.endedAt ?? now)) - segment.start), 0);
}
export function sessionStatus(session: Pick<CasinoSession, "timeSegments" | "endedAt">): "playing" | "paused" | "closed" {
  if (session.endedAt !== null) return "closed";
  return session.timeSegments[session.timeSegments.length - 1].end === undefined ? "playing" : "paused";
}

export type CoinIn = {
  /** Coin-in that earns points (cash only, unless the program counts free play). */
  cents: number;
  source: "points" | "hands" | "estimate" | "none";
  /** From points: the carried remainder makes it uncertain by up to one point's worth either way. */
  withinCents: number;
};
/**
 * Coin-in for one session, from the best reading available: points before and after (Δ × $ per point), else hands
 * played × bet (less free play when free play earns nothing), else the estimate fixed when the session was closed.
 * A session still being played has coin-in only from a points reading.
 */
export function sessionCoinIn(session: CasinoSession, program: Program): CoinIn {
  if (session.pointsBefore !== undefined && session.pointsAfter !== undefined) {
    return { cents: Math.max(0, session.pointsAfter - session.pointsBefore) * pointCents(program), source: "points", withinCents: pointCents(program) };
  }
  if (session.endedAt === null) return { cents: 0, source: "none", withinCents: 0 };
  if (session.handsCount !== undefined) {
    const freePlay = program.freePlayEarnsPoints ? 0 : session.freePlayUsedCents;
    return { cents: Math.max(0, session.handsCount * betCents(session) - freePlay), source: "hands", withinCents: 0 };
  }
  return { cents: session.coinInCents, source: "estimate", withinCents: 0 };
}

/**
 * Points earned per session under the program's rule. A points reading is the machine's own count and is used as is.
 * Otherwise: `carryover` keeps a running coin-in total across every session of the program, in order, and earns a
 * point at each full $ per point (the remainder carries to the next session); `session_floor` rounds each session
 * down on its own; `fractional` doesn't round.
 */
export function pointsEarned(sessions: readonly CasinoSession[], program: Program): Map<string, number> {
  const unit = pointCents(program);
  const result = new Map<string, number>();
  let running = 0;
  for (const session of [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))) {
    const coinIn = sessionCoinIn(session, program);
    let points: number;
    if (coinIn.source === "points") points = session.pointsAfter! - session.pointsBefore!;
    else if (program.rounding === "carryover") points = Math.floor(((running % unit) + coinIn.cents) / unit);
    else if (program.rounding === "session_floor") points = Math.floor(coinIn.cents / unit);
    else points = coinIn.cents / unit;
    running += coinIn.cents;
    result.set(session.id, Math.max(0, points));
  }
  return result;
}

/** Net result of a closed session: cash out − cash in. Free play winnings are already in the cash out. */
export const netCents = (session: CasinoSession) => session.endedAt === null ? null : session.cashOutCents - session.cashInCents;

/** Hands played: the count if entered, else coin-in (plus free play played) ÷ bet. */
export function sessionHands(session: CasinoSession, coinIn: CoinIn, program: Program) {
  if (session.handsCount !== undefined) return session.handsCount;
  const freePlay = program.freePlayEarnsPoints ? 0 : session.freePlayUsedCents;
  return Math.round((coinIn.cents + (coinIn.source === "none" ? 0 : freePlay)) / betCents(session));
}

/** The return a session's play is expected to give: the table's optimal return and yours after measured mistakes. */
export type ReturnInfo = { optimalPct: number; effectivePct: number; measured: boolean };

export type Rollup = {
  sessions: number; closedSessions: number;
  coinInCents: number; points: number; netCents: number; activeMs: number; hands: number;
  theoreticalCostCents: number; mistakeCostCents: number;
  /** Net loss ÷ points (negative when ahead); null without points. */
  actualCostPerPointCents: number | null;
  theoreticalCostPerPointCents: number | null;
  pointsPerHour: number | null; handsPerHour: number | null; coinInPerHourCents: number | null;
  /** Coin-in that came from a points reading, a hand count, or an estimate (for labelling the totals). */
  coinInBySource: Record<CoinIn["source"], number>;
  /** Sessions whose cost used perfect play because there weren't enough practice decisions on the table. */
  unmeasuredSessions: number;
  /** Coin-in with no expected return (another game, or a return not worked out yet): no theoretical cost for it. */
  coinInWithoutReturnCents: number;
};
/**
 * Totals over some of a program's sessions. `points` must come from `pointsEarned` over *all* of the program's
 * sessions (the carryover depends on earlier ones). `returns` gives each session's expected return, or null when the
 * game is unknown (then it adds no theoretical cost).
 */
export function rollup(sessions: readonly CasinoSession[], program: Program, points: ReadonlyMap<string, number>,
  returns: (session: CasinoSession) => ReturnInfo | null, now = Date.now()): Rollup {
  const total: Rollup = {
    sessions: sessions.length, closedSessions: 0, coinInCents: 0, points: 0, netCents: 0, activeMs: 0, hands: 0,
    theoreticalCostCents: 0, mistakeCostCents: 0, actualCostPerPointCents: null, theoreticalCostPerPointCents: null,
    pointsPerHour: null, handsPerHour: null, coinInPerHourCents: null,
    coinInBySource: { points: 0, hands: 0, estimate: 0, none: 0 }, unmeasuredSessions: 0, coinInWithoutReturnCents: 0,
  };
  for (const session of sessions) {
    const coinIn = sessionCoinIn(session, program);
    total.coinInCents += coinIn.cents;
    total.coinInBySource[coinIn.source] += coinIn.cents;
    total.points += points.get(session.id) ?? 0;
    total.activeMs += activeMs(session, now);
    total.hands += sessionHands(session, coinIn, program);
    const net = netCents(session);
    if (net !== null) { total.netCents += net; total.closedSessions++; }
    const expected = returns(session);
    if (expected) {
      total.theoreticalCostCents += coinIn.cents * (1 - expected.effectivePct / 100);
      total.mistakeCostCents += coinIn.cents * Math.max(0, expected.optimalPct - expected.effectivePct) / 100;
      if (!expected.measured && coinIn.cents > 0) total.unmeasuredSessions++;
    } else total.coinInWithoutReturnCents += coinIn.cents;
  }
  if (total.points > 0) {
    total.actualCostPerPointCents = -total.netCents / total.points;
    // Over the points from coin-in with a known return only, so other games don't dilute it.
    const known = total.coinInCents - total.coinInWithoutReturnCents;
    total.theoreticalCostPerPointCents = known > 0 ? total.theoreticalCostCents / (total.points * known / total.coinInCents) : null;
  }
  // Rates need enough play to mean something (a session closed seconds after starting would give absurd ones).
  const hours = total.activeMs / HOUR_MS;
  if (total.activeMs >= MIN_RATE_MS) {
    total.pointsPerHour = total.points / hours;
    total.handsPerHour = total.hands / hours;
    total.coinInPerHourCents = total.coinInCents / hours;
  }
  return total;
}

/** What the rewards are worth against what the play cost. */
export function rewardsSummary(rewards: readonly Reward[], rolled: Pick<Rollup, "netCents" | "points">) {
  const valueCents = rewards.reduce((sum, reward) => sum + reward.valueCents, 0);
  const lossCents = Math.max(0, -rolled.netCents);
  return {
    valueCents,
    /** (net loss − rewards) ÷ points: what a point cost once the rewards are counted. */
    netCostPerPointCents: rolled.points > 0 ? (lossCents - valueCents) / rolled.points : null,
    valuePerPointCents: rolled.points > 0 ? valueCents / rolled.points : null,
    /** (rewards − net loss) ÷ net loss; null when there was no loss. */
    roiPct: lossCents > 0 ? (valueCents - lossCents) / lossCents * 100 : null,
  };
}

/** Theoretical cost of one point: $ per point × (1 − return). */
export const costPerPointCents = (program: Pick<Program, "dollarsPerPoint">, returnPct: number) => program.dollarsPerPoint * 100 * (1 - returnPct / 100);

export type PlanInput = {
  targetPoints: number; pointsSoFar: number; dollarsPerPoint: number;
  betCents: number; handsPerHour: number; hoursLeft: number; effectiveReturnPct: number;
};
export type Plan = {
  pointsNeeded: number; coinInNeededCents: number; handsNeeded: number; hoursNeeded: number;
  pointsPerHour: number; expectedCostCents: number;
  /** null when no hours are left (or none are needed). */
  onTrack: boolean;
  requiredHandsPerHour: number | null; requiredBetCents: number | null;
};
/** The spec's planner (07-CRUISE-REWARDS.md §4), exactly. */
export function plan(input: PlanInput): Plan {
  const pointsNeeded = Math.max(0, input.targetPoints - input.pointsSoFar);
  const coinInNeededCents = pointsNeeded * input.dollarsPerPoint * 100;
  const handsNeeded = input.betCents > 0 ? coinInNeededCents / input.betCents : Infinity;
  const hoursNeeded = input.handsPerHour > 0 ? handsNeeded / input.handsPerHour : Infinity;
  const pointsPerHour = input.handsPerHour * input.betCents / (input.dollarsPerPoint * 100);
  const hoursLeft = Math.max(0, input.hoursLeft);
  return {
    pointsNeeded, coinInNeededCents, handsNeeded, hoursNeeded, pointsPerHour,
    expectedCostCents: coinInNeededCents * (1 - input.effectiveReturnPct / 100),
    onTrack: pointsNeeded === 0 || hoursNeeded <= hoursLeft + 1e-9,
    requiredHandsPerHour: pointsNeeded > 0 && hoursLeft > 0 ? handsNeeded / hoursLeft : null,
    requiredBetCents: pointsNeeded > 0 && hoursLeft > 0 && input.handsPerHour > 0 ? coinInNeededCents / (input.handsPerHour * hoursLeft) : null,
  };
}

/** Local calendar date, YYYY-MM-DD. */
export function localDate(at = Date.now()) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** Each date from start to end inclusive (YYYY-MM-DD), at most 120. */
export function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  const day = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`);
  while (day <= last && dates.length < 120) { dates.push(day.toISOString().slice(0, 10)); day.setUTCDate(day.getUTCDate() + 1); }
  return dates;
}
export const DEFAULT_HOURS = { sea: 6, port: 2 } as const;
/** The trip's days for new dates, keeping what was already set for dates that stay. */
export function tripDays(start: string, end: string, existing: Trip["days"] = []): Trip["days"] {
  return datesBetween(start, end).map(date => existing.find(day => day.date === date) ?? { date, type: "sea", casinoHoursPlanned: DEFAULT_HOURS.sea });
}
/**
 * Casino hours still available: planned hours of the days after today, plus what's left of today's plan after the
 * time already played today. Before the trip, every day; after it, none.
 */
export function hoursLeft(trip: Pick<Trip, "days">, sessions: readonly CasinoSession[], now = Date.now()) {
  const today = localDate(now);
  let hours = 0;
  for (const day of trip.days) {
    if (day.date > today) hours += day.casinoHoursPlanned;
    else if (day.date === today) {
      const playedToday = sessions.reduce((sum, session) => sum + playedOn(session, today, now), 0) / HOUR_MS;
      hours += Math.max(0, day.casinoHoursPlanned - playedToday);
    }
  }
  return hours;
}
/** Active time of a session that fell on a given local date. */
function playedOn(session: CasinoSession, date: string, now: number) {
  let ms = 0;
  for (const segment of session.timeSegments) {
    const end = segment.end ?? session.endedAt ?? now;
    const dayStart = new Date(`${date}T00:00:00`).getTime(), dayEnd = new Date(`${date}T23:59:59.999`).getTime();
    ms += Math.max(0, Math.min(end, dayEnd) - Math.max(segment.start, dayStart));
  }
  return ms;
}
export function plannedHours(trip: Pick<Trip, "days">) { return trip.days.reduce((sum, day) => sum + day.casinoHoursPlanned, 0); }

/** The trip a date falls in decides its default status; a stored status of "done" always wins. */
export function tripPhase(trip: Pick<Trip, "sailStart" | "sailEnd" | "status">, now = Date.now()): Trip["status"] {
  if (trip.status === "done") return "done";
  const today = localDate(now);
  if (today < trip.sailStart) return "planned";
  return today > trip.sailEnd ? "done" : "active";
}

type PracticeDecision = Pick<Records["decisions"], "sessionId" | "createdAt" | "isCorrection" | "coins" | "lines" | "denominationCents">;
/**
 * Pace of practice play: within each session, the time between consecutive hands counts as play unless it is longer
 * than the idle threshold (a break). Hands per hour = counted gaps ÷ their total time. Also the coin-in and points
 * the same play would have earned at its bet.
 */
export function practicePace(decisions: readonly PracticeDecision[], idleMs = PRACTICE_IDLE_MS) {
  const bySession = new Map<string, PracticeDecision[]>();
  for (const decision of decisions) if (!decision.isCorrection) bySession.set(decision.sessionId, [...bySession.get(decision.sessionId) ?? [], decision]);
  let intervals = 0, ms = 0, hands = 0, coinInCents = 0;
  for (const rows of bySession.values()) {
    rows.sort((a, b) => a.createdAt - b.createdAt);
    hands += rows.length;
    for (const row of rows) coinInCents += row.coins * row.lines * row.denominationCents;
    for (let index = 1; index < rows.length; index++) {
      const gap = rows[index].createdAt - rows[index - 1].createdAt;
      if (gap > 0 && gap <= idleMs) { intervals++; ms += gap; }
    }
  }
  return { hands, activeMs: ms, handsPerHour: ms > 0 && intervals >= 20 ? intervals / (ms / HOUR_MS) : null, coinInCents };
}

/** RFC 4180 CSV. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]) {
  return rows.map(row => row.map(value => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\r\n") + "\r\n";
}
