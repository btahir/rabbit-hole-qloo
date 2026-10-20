import { afterEach, expect, it, vi } from "vitest";
import {
  ReleaseBudget,
  warmDemo,
  type WarmOptions,
} from "../src/lib/core/release";
import { MemoryStore, type RedisPort } from "../src/lib/core/store";
import { MODEL } from "../src/lib/core/model-config";
import curated from "../src/lib/core/demo-catalog.json";
import type { Entity, Evidence } from "../src/lib/core/types";
import { activatedSamples } from "../src/lib/core/activated-samples";
import * as storeModule from "../src/lib/core/store";
import { qlooPort } from "../src/lib/core/qloo";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function harness() {
  const data = new Map<string, unknown>();
  const kv = new Map<string, unknown>();
  const entities = curated.map((row) => ({
    ...row,
    source: "Qloo",
    checkedAt: new Date().toISOString(),
    schemaVersion: 1,
  })) as Entity[];
  const budget = new ReleaseBudget();
  const redis = {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kv.set(key, value);
    },
  } as RedisPort;
  const describe = vi.fn(async (ids: string[]) => {
    budget.beforeQloo();
    return entities.filter((row) => ids.includes(row.id));
  });
  const insights = vi.fn<WarmOptions["port"]["insights"]>(async (input) => {
    budget.beforeQloo();
    const candidates = entities.filter((row) => row.medium === input.medium);
    return {
      entities: candidates,
      evidence: {
        anchor: input.anchor,
        source: "qloo",
        kind: "discovery",
        medium: input.medium,
        results: candidates.map((row, i) => ({ id: row.id, position: i + 1 })),
      } as Evidence,
    };
  });
  const executeArm = vi.fn<WarmOptions["executeArm"]>(
    async (brief, condition, options) => {
      await options.onStep();
      const discovery =
        condition === "with" ? await options.affinity() : undefined;
      return {
        ids: (discovery?.entities ?? brief.catalog)
          .slice(0, 3)
          .map((e) => e.id),
        evidence: discovery?.evidence,
        modelSteps: 2,
        actualCost: 100,
      };
    },
  );
  const options: WarmOptions = {
    records: {
      get: async <T>(key: string) => (data.get(key) ?? null) as T | null,
      put: async (key, value) => {
        if (!data.has(key)) data.set(key, value);
      },
    },
    redis,
    namespace: "rabbit-hole:test",
    storage: new MemoryStore(),
    budget,
    port: {
      describeEntities: describe,
      insights,
      resolveStart: async () => [],
    },
    model: MODEL,
    executeArm,
    signal: new AbortController().signal,
    log: vi.fn(),
  };
  return { options, data, kv, describe, insights, executeArm };
}

it("installs three live samples and five paired comparisons; repeat release restores KV without spending", async () => {
  const h = harness();
  const first = await warmDemo(h.options);
  expect(first.samples).toBe(3);
  expect(first.comparisons).toBe(5);
  expect(first.qlooAttempts).toBeLessThanOrEqual(30);
  expect(first.modelReservedMicrodollars).toBeLessThanOrEqual(100_000);
  expect(h.executeArm).toHaveBeenCalledTimes(10);
  const before = await h.options.storage.transact(
    (db) => db.budgets.cumulative,
  );
  h.kv.clear();
  const next = await warmDemo({ ...h.options, budget: new ReleaseBudget() });
  expect(next).toEqual({
    samples: 3,
    comparisons: 5,
    qlooAttempts: 0,
    modelReservedMicrodollars: 0,
  });
  expect(h.executeArm).toHaveBeenCalledTimes(10);
  expect(await h.options.storage.transact((db) => db.budgets.cumulative)).toBe(
    before,
  );
  expect(h.kv.get("rabbit-hole:test:samples:v2")).toHaveLength(3);
  expect(h.kv.get("rabbit-hole:test:comparisons:v2")).toHaveLength(5);
});

it("keeps failed warmups unavailable and resumes from successful checkpoints", async () => {
  const h = harness();
  const realArm = h.executeArm.getMockImplementation()!;
  h.executeArm.mockRejectedValue(new Error("provider outage"));
  const first = await warmDemo(h.options);
  expect(first.samples).toBe(0);
  expect(first.comparisons).toBe(0);
  expect(h.kv.has("rabbit-hole:test:samples:v2")).toBe(false);
  const hydrations = h.describe.mock.calls.length;
  const openingCalls = h.insights.mock.calls.length;
  h.executeArm.mockImplementation(realArm);
  const second = await warmDemo({ ...h.options, budget: new ReleaseBudget() });
  expect(second.samples).toBe(3);
  expect(second.comparisons).toBe(5);
  expect(h.describe).toHaveBeenCalledTimes(hydrations);
  expect(h.insights).toHaveBeenCalledTimes(openingCalls + 5);
});

it("retains completed arms when the other arm fails", async () => {
  const h = harness();
  const realArm = h.executeArm.getMockImplementation()!;
  h.executeArm.mockImplementation((brief, condition, options) => {
    if (condition === "without") throw new Error("interrupted");
    return realArm(brief, condition, options);
  });
  await warmDemo(h.options);
  expect([...h.data.keys()].filter((k) => k.startsWith("arm:"))).toHaveLength(
    5,
  );
  h.executeArm.mockClear().mockImplementation(realArm);
  await warmDemo({ ...h.options, budget: new ReleaseBudget() });
  expect(h.executeArm).toHaveBeenCalledTimes(5);
  expect(
    h.executeArm.mock.calls.every(([, condition]) => condition === "without"),
  ).toBe(true);
});

it("fails closed before the 31st Qloo attempt or a reservation beyond ten cents", () => {
  const budget = new ReleaseBudget();
  for (let i = 0; i < 30; i++) budget.beforeQloo();
  expect(() => budget.beforeQloo()).toThrow();
  expect(budget.qlooAttempts).toBe(30);
  while (budget.modelReserved + 6048 <= 100_000) budget.reserveModel();
  expect(() => budget.reserveModel()).toThrow();
  expect(budget.modelReserved).toBeLessThanOrEqual(100_000);
});

it("applies the Qloo guard at the HTTP boundary, including retries", async () => {
  vi.stubEnv("QLOO_API_KEY", "unit-test-only");
  const budget = new ReleaseBudget();
  budget.qlooAttempts = 29;
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("outage", { status: 503 }));
  const storage = new MemoryStore();
  await storage.transact((db) => {
    db.runs.test = {
      state: "running",
      leaseUntil: Date.now() + 60_000,
      attempts: 0,
    } as never;
    db.trails.test = { counters: { attempts: 0 } } as never;
  });
  const port = qlooPort({
    storage,
    owner: "release-cap",
    mode: "live",
    runId: "test",
    trailId: "test",
    beforeAttempt: budget.beforeQloo,
    fetch: transport,
  });
  await expect(
    port.resolveStart("guard retry boundary", "movie"),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(budget.qlooAttempts).toBe(30);
});

it("respects global spend caps before contacting Haiku", async () => {
  vi.stubEnv("DAILY_BUDGET_USD", "0");
  const h = harness();
  const result = await warmDemo(h.options);
  expect(result.samples).toBe(0);
  expect(h.executeArm).not.toHaveBeenCalled();
});

it("renders unavailable samples when KV is down", async () => {
  vi.stubEnv("QLOO_API_KEY", "unit-test-only");
  vi.spyOn(storeModule, "redisClient").mockReturnValue({
    get: async () => {
      throw new Error("unavailable");
    },
  } as unknown as RedisPort);
  await expect(activatedSamples()).resolves.toEqual([]);
});
