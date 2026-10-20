import "server-only";
import { AppError, assert } from "./errors";
import type { Database, Run, Trail } from "./types";
export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
export const RESERVATION = 20_000; // microdollars; integer accounting throughout
export function rate(
  db: Database,
  key: string,
  max: number,
  windowMs: number,
  now: number,
) {
  const cutoff =
    windowMs === 86_400_000 ? Date.parse(dayKey(now)) : now - windowMs;
  const values = (db.windows[key] ?? []).filter((t) => t >= cutoff && t <= now);
  if (values.length >= max)
    throw new AppError(
      "limit",
      429,
      windowMs === 86_400_000
        ? Date.parse(dayKey(now)) + windowMs
        : values[0] + windowMs + 1,
    );
  db.windows[key] = [...values, now];
}
export type LimitKind =
  "run" | "search" | "write" | "read" | "session" | "replay";
export function limitRules(owner: string, ip: string, kind: LimitKind) {
  const limits = {
    run: [3, 20, 10, 60],
    search: [10, 30, 20, 100],
    write: [5, 100, 20, 300],
    read: [60, 2000, 120, 5000],
    session: [10, 100, 10, 100],
    replay: [60, 2000, 120, 5000],
  }[kind];
  return [
    { key: `${kind}:s:m:${owner}`, max: limits[0], windowMs: 60_000 },
    { key: `${kind}:s:d:${owner}`, max: limits[1], windowMs: 86_400_000 },
    { key: `${kind}:i:m:${ip}`, max: limits[2], windowMs: 60_000 },
    { key: `${kind}:i:d:${ip}`, max: limits[3], windowMs: 86_400_000 },
  ];
}
export function applyLimits(
  db: Database,
  owner: string,
  ip: string,
  kind: LimitKind,
  now: number,
) {
  for (const rule of limitRules(owner, ip, kind))
    rate(db, rule.key, rule.max, rule.windowMs, now);
}
export function reserve(
  db: Database,
  trail: Trail,
  run: Run,
  ip: string,
  now: number,
) {
  if (trail.mode !== "fixture" && process.env.INFERENCE_PAUSED === "1")
    throw new AppError("paused", 503);
  assert(
    trail.counters.runs < 8 &&
      trail.counters.insights < 16 &&
      trail.counters.attempts < 48,
    "trail_limit",
    429,
  );
  const active = Object.values(db.runs).filter(
    (r) => ["reserved", "running"].includes(r.state) && r.leaseUntil > now,
  );
  if (active.some((r) => r.owner === run.owner) || active.length >= 10)
    throw new AppError("limit", 429, now + 60_000);
  applyLimits(db, run.owner, ip, "run", now);
  const amount = run.reserved,
    day = dayKey(now);
  const daily = Number(process.env.DAILY_BUDGET_USD || 3) * 1e6,
    cumulative = Number(process.env.TOTAL_BUDGET_USD || 25) * 1e6;
  if (
    ![daily, cumulative].every((n) => Number.isFinite(n) && n >= 0) ||
    (db.budgets.daily[day] ?? 0) + amount > daily ||
    db.budgets.cumulative + amount > cumulative
  )
    throw new AppError("paused", 503);
  db.budgets.daily[day] = (db.budgets.daily[day] ?? 0) + amount;
  db.budgets.cumulative += amount;
  trail.counters.runs++;
  trail.activeRun = run.id;
  db.runs[run.id] = run;
}
export function settle(db: Database, run: Run, actualMicrodollars?: number) {
  if (run.settled || actualMicrodollars === undefined) return;
  assert(
    Number.isFinite(actualMicrodollars) &&
      actualMicrodollars >= 0 &&
      actualMicrodollars <= run.reserved,
    "paused",
    503,
  );
  const refund = run.reserved - Math.ceil(actualMicrodollars);
  db.budgets.cumulative -= refund;
  db.budgets.daily[run.day] -= refund;
  run.settled = true;
}
export function claimInsights(trail: Trail, run: Run) {
  assert(run.insights < 2 && trail.counters.insights < 16, "trail_limit", 429);
  run.insights++;
  trail.counters.insights++;
}
export function claimQloo(
  db: Database,
  trail: Trail | undefined,
  run: Run | undefined,
  lease: string,
  now: number,
) {
  if (process.env.INFERENCE_PAUSED === "1") throw new AppError("paused", 503);
  if (db.circuitUntil > now) throw new AppError("limit", 429, db.circuitUntil);
  const allowance = Number(process.env.QLOO_DAILY_ATTEMPTS || 150);
  assert(
    Number.isSafeInteger(allowance) && allowance > 0 && allowance <= 500,
    "configuration",
    503,
  );
  const day = dayKey(now);
  assert((db.qloo[day] ?? 0) < allowance, "paused", 503);
  if (run)
    assert(
      run.attempts < 6 && trail && trail.counters.attempts < 48,
      "trail_limit",
      429,
    );
  if (Object.values(db.qlooLeases).filter((t) => t > now).length >= 2)
    throw new AppError("limit", 429, now + 1000);
  db.qloo[day] = (db.qloo[day] ?? 0) + 1;
  db.qlooLeases[lease] = now + 12_000;
  if (run && trail) {
    run.attempts++;
    trail.counters.attempts++;
  }
}
export function modelBound(inputRate: number, outputRate: number): number {
  assert(
    [inputRate, outputRate].every((n) => Number.isFinite(n) && n > 0),
    "configuration",
    503,
  );
  const bound = 4 * (8000 * inputRate + 1024 * outputRate); // USD/1M -> microdollars
  assert(bound <= RESERVATION, "configuration", 503);
  return bound;
}
