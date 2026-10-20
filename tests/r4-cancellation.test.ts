import { afterEach, expect, it, vi } from "vitest";
import { setup, key } from "./helpers";
import { agentInput } from "../src/lib/core/runs";
import * as qloo from "../src/lib/core/qloo";
import { AppError } from "../src/lib/core/errors";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("a Stop on an independently loaded worker aborts a hanging provider without late commit", async () => {
  const c = await setup();
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let aborted = false;
  vi.spyOn(qloo, "qlooPort").mockImplementation(({ signal }) => ({
    resolveStart: async () => [],
    describeEntities: async () => [],
    insights: async () =>
      new Promise((_resolve, reject) => {
        entered();
        signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(signal!.reason);
          },
          { once: true },
        );
      }),
  }));
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: 1,
    intent: "generate",
    idempotencyKey: key(),
  });
  const accepted = await c.runs.begin(c.owner, c.ip, input);
  const executing = c.runs.execute(
    c.owner,
    accepted.run.id,
    input,
    accepted.trail,
    () => {},
  );
  await waiting;
  vi.resetModules();
  const { RunService: OtherWorker } = await import("../src/lib/core/runs");
  const start = performance.now();
  await new OtherWorker(c.storage).cancel(c.owner, accepted.run.id);
  await executing;
  expect(aborted).toBe(true);
  expect(performance.now() - start).toBeLessThan(2000);
  const run = await c.runs.read(c.owner, accepted.run.id);
  expect(run.state).toBe("cancelled");
  expect(run.trail.current).toBeUndefined();
  expect(run.trail.counters.runs).toBe(1);
});
it("a final projection read failure cannot turn an already committed generation into a failed run", async () => {
  const c = await setup();
  const { RunService } = await import("../src/lib/core/runs");
  const runs = new RunService(c.storage);
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: 1,
    intent: "generate",
    idempotencyKey: key(),
  });
  const accepted = await runs.begin(c.owner, c.ip, input);
  const spy = vi
    .spyOn(runs, "read")
    .mockRejectedValueOnce(new AppError("storage", 503));
  await runs.execute(c.owner, accepted.run.id, input, accepted.trail, () => {});
  spy.mockRestore();
  const run = await runs.read(c.owner, accepted.run.id);
  expect(run.state).toBe("committed");
  expect(run.trail.current).toBeDefined();
  expect(run.trail.version).toBe(2);
});
