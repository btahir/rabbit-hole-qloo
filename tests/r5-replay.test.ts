import { beforeEach, expect, it, vi } from "vitest";
import { setup, key } from "./helpers";
import { agentInput } from "../src/lib/core/runs";
import { fixtureCatalog } from "../src/lib/core/fixtures";
import { AppError } from "../src/lib/core/errors";

beforeEach(() => {
  vi.stubEnv("QLOO_MODE", "fixture");
  vi.stubEnv("INFERENCE_PAUSED", "0");
  vi.stubEnv("DAILY_BUDGET_USD", "5");
  vi.stubEnv("TOTAL_BUDGET_USD", "25");
});

it("SPEC 7/11/22: locked empty completion must deliver the newly requested direction to a version-aware client", async () => {
  const c = await setup();
  await c.storage.transact((db) => {
    db.trails[c.trail.id].excluded = fixtureCatalog
      .filter((e) => e.medium === "book")
      .map((entity) => ({ entity, reason: "known" }));
  });
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: c.trail.version,
    intent: "generate",
    destination: "book",
    idempotencyKey: key(),
  });
  const accepted = await c.runs.begin(c.owner, c.ip, input);
  await c.runs.execute(
    c.owner,
    accepted.run.id,
    input,
    accepted.trail,
    () => {},
  );
  const full = await c.runs.read(c.owner, accepted.run.id);
  const replay = await c.runs.read(
    c.owner,
    accepted.run.id,
    0,
    c.trail.version,
  );
  expect(full.state).toBe("committed");
  expect(full.trail.directionRequest).toBe("artist");
  expect(replay.trail?.directionRequest).toBe("artist");
  expect(replay.trail.version).toBe(c.trail.version + 1);
  expect(replay.events.at(-1)?.type).toBe("complete");
});

it("SPEC 22: a refreshed active-run client must receive cleared activeRun after cancellation", async () => {
  const c = await setup();
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: c.trail.version,
    intent: "generate",
    idempotencyKey: key(),
  });
  const accepted = await c.runs.begin(c.owner, c.ip, input);
  const refreshed = await c.service.read(c.owner, c.trail.id, c.ip);
  expect(refreshed.activeRun).toBe(accepted.run.id);
  await c.runs.cancel(c.owner, accepted.run.id);
  const full = await c.runs.read(c.owner, accepted.run.id);
  const replay = await c.runs.read(
    c.owner,
    accepted.run.id,
    0,
    refreshed.version,
  );
  expect(full.trail.activeRun).toBeUndefined();
  expect(replay.trail).toBeDefined();
});

it("SPEC 22: a refreshed active-run client must receive cleared activeRun after lease expiry", async () => {
  const c = await setup();
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: c.trail.version,
    intent: "generate",
    idempotencyKey: key(),
  });
  const accepted = await c.runs.begin(c.owner, c.ip, input);
  const refreshed = await c.service.read(c.owner, c.trail.id, c.ip);
  c.runs.now = () => accepted.run.createdAt + 60_001;
  const full = await c.runs.read(c.owner, accepted.run.id);
  const replay = await c.runs.read(
    c.owner,
    accepted.run.id,
    0,
    refreshed.version,
  );
  expect(full.state).toBe("expired");
  expect(full.trail.activeRun).toBeUndefined();
  expect(replay.trail).toBeDefined();
});

it("SPEC 11/22: a refreshed active-run client must receive cleared activeRun after a run failure", async () => {
  const c = await setup();
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: c.trail.version,
    intent: "generate",
    idempotencyKey: key(),
  });
  const accepted = await c.runs.begin(c.owner, c.ip, input);
  const refreshed = await c.service.read(c.owner, c.trail.id, c.ip);
  let executionWrites = 0;
  c.runs.storage = {
    transact: async (fn, now) => {
      executionWrites++;
      if (executionWrites === 2) throw new AppError("storage", 503);
      return c.storage.transact(fn, now);
    },
  };
  await c.runs.execute(
    c.owner,
    accepted.run.id,
    input,
    accepted.trail,
    () => {},
  );
  const full = await c.runs.read(c.owner, accepted.run.id);
  const replay = await c.runs.read(
    c.owner,
    accepted.run.id,
    0,
    refreshed.version,
  );
  expect(full.state).toBe("failed");
  expect(full.error).toBe("storage");
  expect(full.trail.activeRun).toBeUndefined();
  expect(replay.trail).toBeDefined();
});
