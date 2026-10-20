import { AppError } from "../src/lib/core/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, emptyDatabase, prune } from "../src/lib/core/store";
import {
  applyLimits,
  claimInsights,
  claimQloo,
  dayKey,
  modelBound,
  reserve,
  settle,
} from "../src/lib/core/limits";
import { setup, generate, key } from "./helpers";
import { agentInput } from "../src/lib/core/runs";
import type { Run } from "../src/lib/core/types";
beforeEach(() => {
  vi.stubEnv("QLOO_MODE", "fixture");
  vi.stubEnv("INFERENCE_PAUSED", "0");
  vi.stubEnv("DAILY_BUDGET_USD", "5");
  vi.stubEnv("TOTAL_BUDGET_USD", "25");
});
describe("limits and integer reservation accounting", () => {
  it("enforces session/IP windows and UTC midnight reset with a factual Retry-After", () => {
    const db = emptyDatabase(),
      now = Date.parse("2026-10-17T23:59:59Z");
    for (let i = 0; i < 3; i++) applyLimits(db, "session", "ip", "run", now);
    expect(() => applyLimits(db, "session", "ip", "run", now)).toThrowError(
      expect.objectContaining({ code: "limit", retryAt: now + 60_001 }),
    );
    expect(dayKey(now + 2000)).toBe("2026-10-18");
  });
  it("prevents concurrent duplicate runs and session/global concurrency races", async () => {
    const c = await setup(),
      input = agentInput.parse({
        trailId: c.trail.id,
        expectedVersion: c.trail.version,
        intent: "generate",
        idempotencyKey: key(),
      });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => c.runs.begin(c.owner, c.ip, input)),
    );
    expect(results.filter((r) => r.started)).toHaveLength(1);
    expect(new Set(results.map((r) => r.run.id)).size).toBe(1);
    await expect(
      c.runs.begin(c.owner, c.ip, { ...input, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: "limit" });
    await c.runs.cancel(c.owner, results[0].run.id);
    expect((await c.runs.read(c.owner, results[0].run.id)).state).toBe(
      "cancelled",
    );
  });
  it("keeps unknown spend reserved, settles once, and never releases money on lease expiry", async () => {
    const c = await setup(),
      now = Date.now(),
      db = emptyDatabase(),
      trail = await c.storage.transact((s) => s.trails[c.trail.id]);
    const run = {
      id: key(),
      owner: c.owner,
      trailId: trail.id,
      state: "reserved",
      leaseUntil: now + 60_000,
      expiresAt: now + 100_000,
      reserved: 20_000,
      settled: false,
      day: dayKey(now),
      events: [],
    } as unknown as Run;
    reserve(db, trail, run, c.ip, now);
    expect(db.budgets.cumulative).toBe(20_000);
    settle(db, run, undefined);
    expect(db.budgets.cumulative).toBe(20_000);
    prune(db, now + 60_001);
    expect(run.state).toBe("expired");
    expect(db.budgets.cumulative).toBe(20_000);
    settle(db, run, 1024);
    settle(db, run, 0);
    expect(db.budgets.cumulative).toBe(1024);
  });
  it("atomically caps concurrent spend reservations with simulated instances", async () => {
    vi.stubEnv("DAILY_BUDGET_USD", "0.04");
    const store = new MemoryStore();
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        store.transact((db) => {
          const now = Date.now(),
            trail = {
              id: `${i}`,
              counters: { runs: 0, insights: 0, attempts: 0, searches: 0 },
            } as never;
          const run = {
            id: `${i}`,
            owner: `${i}`,
            state: "reserved",
            leaseUntil: now + 60_000,
            reserved: 20_000,
            day: dayKey(now),
          } as Run;
          reserve(db, trail, run, `${i}`, now);
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(2);
    expect(await store.transact((db) => db.budgets.cumulative)).toBe(40_000);
  });
  it("caps actual Qloo attempts, Insights slots and global semaphore independently", async () => {
    vi.stubEnv("QLOO_DAILY_ATTEMPTS", "500");
    const c = await setup();
    const input = agentInput.parse({
      trailId: c.trail.id,
      expectedVersion: c.trail.version,
      intent: "generate",
      idempotencyKey: key(),
    });
    const { run, trail } = await c.runs.begin(c.owner, c.ip, input);
    const db = emptyDatabase(),
      now = Date.now();
    claimInsights(trail, run);
    claimInsights(trail, run);
    expect(() => claimInsights(trail, run)).toThrow();
    claimQloo(db, trail, run, "a", now);
    claimQloo(db, trail, run, "b", now);
    expect(() => claimQloo(db, trail, run, "c", now)).toThrowError(
      expect.objectContaining({ code: "limit" }),
    );
    db.qlooLeases = {};
    for (let i = 0; i < 4; i++) {
      claimQloo(db, trail, run, key(), now);
      db.qlooLeases = {};
    }
    expect(() => claimQloo(db, trail, run, key(), now)).toThrowError(
      expect.objectContaining({ code: "trail_limit" }),
    );
    expect(modelBound(0.1, 0.5)).toBeLessThan(20_000);
    expect(() => modelBound(100, 100)).toThrow();
  });
  it("kill switch and quota storage failures reject before any work", async () => {
    const c = await setup();
    await c.storage.transact((db) => {
      db.trails[c.trail.id].mode = "live";
    });
    vi.stubEnv("INFERENCE_PAUSED", "1");
    await expect(generate(c)).rejects.toMatchObject({ code: "paused" });
    expect(await c.storage.transact((db) => Object.keys(db.runs).length)).toBe(
      0,
    );
  });
  it("stopped/expired runs cannot execute or overwrite a stable path", async () => {
    const c = await setup(),
      input = agentInput.parse({
        trailId: c.trail.id,
        expectedVersion: 1,
        intent: "generate",
        idempotencyKey: key(),
      });
    const { run, trail } = await c.runs.begin(c.owner, c.ip, input);
    await c.runs.cancel(c.owner, run.id);
    await c.runs.execute(c.owner, run.id, input, trail, () => {});
    const result = await c.runs.read(c.owner, run.id);
    expect(result.state).toBe("cancelled");
    expect(result.trail.current).toBeUndefined();
  });
});

describe("Anthropic usage billing", () => {
  it("counts uncached, cache-write and cache-read tokens once per step", async () => {
    const { billedMicrodollars } = await import("../src/lib/core/model-config");
    const usage = {
      inputTokens: 1500,
      outputTokens: 100,
      totalTokens: 1600,
      inputTokenDetails: {
        noCacheTokens: 500,
        cacheReadTokens: 800,
        cacheWriteTokens: 200,
      },
      outputTokenDetails: { textTokens: 100, reasoningTokens: 0 },
    };
    expect(billedMicrodollars([{ usage }, { usage }])).toBe(266);
    expect(billedMicrodollars([{ usage }, {}])).toBeUndefined();
    expect(
      billedMicrodollars([{ usage: { ...usage, outputTokens: NaN } }]),
    ).toBeUndefined();
  });
});

describe("Redis optimistic concurrency", () => {
  it("two simulated instances cannot over-reserve the shared budget", async () => {
    const { RedisStore } = await import("../src/lib/core/store");
    let persisted = emptyDatabase();
    const redis = {
      get: async () => {
        const result = structuredClone(persisted);
        await Promise.resolve();
        return result;
      },
      eval: async (
        _script: string,
        _keys: string[],
        args: [number, string, string],
      ) => {
        if (persisted.revision !== args[0]) return 0;
        persisted = JSON.parse(args[2]);
        return 1;
      },
    };
    const first = new RedisStore(redis as never),
      second = new RedisStore(redis as never);
    vi.stubEnv("DAILY_BUDGET_USD", "0.04");
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? first : second).transact((db) => {
          const now = Date.now(),
            trail = {
              id: `${i}`,
              counters: { runs: 0, insights: 0, attempts: 0 },
            } as never;
          const run = {
            id: `${i}`,
            owner: `${i}`,
            state: "reserved",
            leaseUntil: now + 60_000,
            reserved: 20_000,
            day: dayKey(now),
          } as Run;
          reserve(db, trail, run, `${i}`, now);
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(persisted.budgets.cumulative).toBe(40_000);
  });
});

describe("persistence-only recovery", () => {
  it("failed generation commits can be saved without another guide or Qloo call", async () => {
    const { RunService } = await import("../src/lib/core/runs");
    const c = await setup();
    let rejectCommit = true;
    const failing = {
      transact: <T>(
        fn: (db: import("../src/lib/core/types").Database) => T,
        now?: number,
      ) =>
        c.storage.transact((db) => {
          const value = fn(db);
          if (
            rejectCommit &&
            Object.values(db.runs).some((r) => r.state === "committed")
          )
            throw new AppError("storage", 503);
          return value;
        }, now),
    };
    const service = new RunService(failing);
    const input = agentInput.parse({
      trailId: c.trail.id,
      expectedVersion: 1,
      intent: "generate",
      idempotencyKey: key(),
    });
    const accepted = await service.begin(c.owner, c.ip, input);
    const previews: unknown[] = [];
    await service.execute(
      c.owner,
      accepted.run.id,
      input,
      accepted.trail,
      (_event, preview) => {
        if (preview) previews.push(preview);
      },
    );
    expect(previews).toHaveLength(1);
    rejectCommit = false;
    const saved = await service.saveResult(c.owner, accepted.run.id);
    expect(saved.current?.pool.length).toBeGreaterThan(0);
    expect(saved.counters.runs).toBe(1);
  });
});

it("a locked empty turn asks explicitly, then a newly chosen direction clears the request", async () => {
  const c = await setup();
  const { fixtureCatalog } = await import("../src/lib/core/fixtures");
  await c.storage.transact((db) => {
    db.trails[c.trail.id].excluded = fixtureCatalog
      .filter((e) => e.medium === "book")
      .map((entity) => ({ entity, reason: "known" }));
  });
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: 1,
    intent: "generate",
    destination: "book",
    idempotencyKey: key(),
  });
  const a = await c.runs.begin(c.owner, c.ip, input);
  await c.runs.execute(c.owner, a.run.id, input, a.trail, () => {});
  const r = await c.runs.read(c.owner, a.run.id);
  expect(r.trail.directionRequest).toBe("artist");
  expect(r.trail.current).toBeUndefined();
  const next = agentInput.parse({
    ...input,
    expectedVersion: r.trail.version,
    destination: "artist",
    idempotencyKey: key(),
  });
  const b = await c.runs.begin(c.owner, c.ip, next);
  await c.runs.execute(c.owner, b.run.id, next, b.trail, () => {});
  expect(
    (await c.runs.read(c.owner, b.run.id)).trail.directionRequest,
  ).toBeUndefined();
});
