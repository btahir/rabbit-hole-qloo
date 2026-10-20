import { afterEach, expect, it, vi } from "vitest";
import { setup, key } from "./helpers";
import { agentInput, RunService } from "../src/lib/core/runs";
import { AppError } from "../src/lib/core/errors";
import type { Database } from "../src/lib/core/types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("acknowledges the same saved preview receipt after the first successful save response is lost", async () => {
  vi.stubEnv("QLOO_MODE", "fixture");
  vi.stubEnv("INFERENCE_PAUSED", "0");
  const fetcher = vi.fn(() => {
    throw new Error("Network is forbidden in this QA regression");
  });
  vi.stubGlobal("fetch", fetcher);
  const context = await setup();
  let rejectCommit = true;
  const storage = {
    transact: <T>(fn: (db: Database) => T, now?: number) =>
      context.storage.transact((db) => {
        const result = fn(db);
        if (
          rejectCommit &&
          Object.values(db.runs).some((run) => run.state === "committed")
        ) {
          throw new AppError("storage", 503);
        }
        return result;
      }, now),
  };
  const runs = new RunService(storage);
  const input = agentInput.parse({
    trailId: context.trail.id,
    expectedVersion: context.trail.version,
    intent: "generate",
    idempotencyKey: key(),
  });
  const accepted = await runs.begin(context.owner, context.ip, input);
  let receipt = "";
  await runs.execute(
    context.owner,
    accepted.run.id,
    input,
    accepted.trail,
    (_event, _preview, value) => {
      if (value) receipt = value;
    },
  );
  expect(receipt.length).toBeGreaterThan(100);
  expect((await runs.read(context.owner, accepted.run.id)).state).toBe(
    "unsaved",
  );

  rejectCommit = false;
  // Server committed the first save. Simulate losing only its HTTP acknowledgment.
  const first = await runs.saveResult(context.owner, accepted.run.id, receipt);
  expect(first.current?.pool).toHaveLength(12);
  expect((await runs.read(context.owner, accepted.run.id)).state).toBe(
    "committed",
  );
  const beforeRetry = await context.service.read(context.owner, first.id);

  // Browser still holds exactly the same run/receipt and clicks Try saving again.
  const [retry] = await Promise.allSettled([
    runs.saveResult(context.owner, accepted.run.id, receipt),
  ]);
  const afterRetry = await context.service.read(context.owner, first.id);
  expect(afterRetry).toEqual(beforeRetry);
  expect(afterRetry.counters.runs).toBe(1);
  expect(fetcher).not.toHaveBeenCalled();

  expect(
    retry.status,
    "A lost successful persistence acknowledgment must be safely retryable",
  ).toBe("fulfilled");
  if (retry.status === "fulfilled") expect(retry.value).toEqual(first);
  const branched = await context.service.action(
    context.owner,
    context.ip,
    first.id,
    first.version,
    key(),
    { action: "branch", branchPoint: 0 },
  );
  expect(branched.generations).toHaveLength(0);
  await expect(
    runs.saveResult(context.owner, accepted.run.id, receipt),
  ).resolves.toEqual(branched);
});

it("a cancelled unsaved receipt cannot revive the run", async () => {
  const c = await setup();
  const storage = {
    transact: <T>(fn: (db: Database) => T, now?: number) =>
      c.storage.transact((db) => {
        const result = fn(db);
        if (Object.values(db.runs).some((r) => r.state === "committed"))
          throw new AppError("storage", 503);
        return result;
      }, now),
  };
  const runs = new RunService(storage);
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: 1,
    intent: "generate",
    idempotencyKey: key(),
  });
  const accepted = await runs.begin(c.owner, c.ip, input);
  let receipt = "";
  await runs.execute(
    c.owner,
    accepted.run.id,
    input,
    accepted.trail,
    (_e, _p, value) => {
      if (value) receipt = value;
    },
  );
  expect(receipt).not.toBe("");
  await c.runs.cancel(c.owner, accepted.run.id);
  await expect(
    c.runs.saveResult(c.owner, accepted.run.id, receipt),
  ).rejects.toMatchObject({ code: "cancelled" });
});
