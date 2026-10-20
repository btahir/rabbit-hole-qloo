import { afterEach, expect, it, vi } from "vitest";
import { setup, key } from "./helpers";
import { fixtureSearch } from "../src/lib/core/fixtures";
import { agentInput } from "../src/lib/core/runs";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("manual example confirmation stays synthetic on a live installation without a provider request", async () => {
  const c = await setup();
  vi.stubEnv("QLOO_MODE", "live");
  vi.stubEnv("QLOO_API_KEY", "never-send-this-test-value");
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("No provider in an example");
  });
  const identity = fixtureSearch("Spirited Away", "movie")[0];
  const trail = await c.service.create(
    c.owner,
    c.ip,
    identity.id,
    key(),
    false,
    true,
  );
  expect(trail.mode).toBe("fixture");
  expect(trail.root.name).toBe("Spirited Away");
  const input = agentInput.parse({
    trailId: trail.id,
    expectedVersion: trail.version,
    intent: "generate",
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
  const result = await c.runs.read(c.owner, accepted.run.id);
  expect(result.state).toBe("committed");
  expect(result.attempts).toBe(0);
  expect(result.modelSteps).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    c.service.create(c.owner, c.ip, "fixture:invented", key(), false, true),
  ).rejects.toMatchObject({ code: "input" });
  await expect(
    c.service.create(
      c.owner,
      c.ip,
      "df000000-0000-4000-8000-000000000001",
      key(),
      false,
      true,
    ),
  ).rejects.toMatchObject({ code: "input" });
});
