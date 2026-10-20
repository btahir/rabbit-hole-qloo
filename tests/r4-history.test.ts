import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup, generate, key } from "./helpers";
import { MemoryStore, RETENTION } from "../src/lib/core/store";
import { TrailService } from "../src/lib/core/service";
import { RunService, agentInput } from "../src/lib/core/runs";
import { samples } from "../src/lib/core/fixtures";
import { visibleDoors } from "../src/lib/core/types";

// Permanent regressions. Every provider credential is blanked by setup.ts;
// fixtures are forced here and any unexpected external fetch fails immediately.
beforeEach(() => {
  vi.stubEnv("QLOO_MODE", "fixture");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("QA regression must never make a network request");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("owner retention and independent history", () => {
  it("SPEC 6.1/25: active use renews a session so a day-29 new trail remains usable on day 30", async () => {
    vi.useFakeTimers();
    const start = Date.parse("2026-10-19T12:00:00Z");
    vi.setSystemTime(start);
    const storage = new MemoryStore();
    const service = new TrailService(storage);
    const runs = new RunService(storage);
    const owner = "qa-retention-owner";
    const ip = "qa-retention-ip";
    await service.session(owner, ip);
    await service.create(owner, ip, samples[0].id, key(), true);

    vi.setSystemTime(start + 29 * 86400_000);
    await service.session(owner, ip); // Explicit normal-use bootstrap.
    const fresh = await service.create(owner, ip, samples[1].id, key(), true);
    expect(fresh.expiresAt).toBe(Date.now() + RETENTION);

    vi.setSystemTime(start + RETENTION + 1000);
    expect(fresh.expiresAt - Date.now()).toBeGreaterThan(28 * 86400_000);
    const input = agentInput.parse({
      trailId: fresh.id,
      expectedVersion: fresh.version,
      intent: "generate",
      idempotencyKey: key(),
    });
    // The trail is only one day old and retains almost 29 days of promised life.
    // Actual round-3 result: rejected AppError {code: "owner", status: 403}.
    await expect(runs.begin(owner, ip, input)).resolves.toMatchObject({
      started: true,
    });
  });

  it("SPEC 3.4/17: undoing a save must preserve the independent undo of the preceding branch", async () => {
    const c = await setup();
    let trail = c.trail;
    for (let i = 0; i < 2; i++) {
      trail = await generate(c, trail);
      trail = await c.service.action(
        c.owner,
        c.ip,
        trail.id,
        trail.version,
        key(),
        {
          action: "follow",
          entityId: visibleDoors(trail)[0].id,
          generationId: trail.current!.id,
        },
      );
    }
    const originalPath = trail.steps.map((step) => step.entity.id);
    const runCount = trail.counters.runs;
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      {
        action: "branch",
        branchPoint: 1,
      },
    );
    expect(trail.steps).toHaveLength(1);
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      {
        action: "save",
        entityId: trail.root.id,
      },
    );
    expect(trail.saved.map((entity) => entity.id)).toContain(trail.root.id);
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      {
        action: "undo",
      },
    );
    expect(trail.saved).toHaveLength(0);
    expect(trail.steps).toHaveLength(1);
    expect(trail.counters.runs).toBe(runCount);
    // Actual round-3 result: canUndo=false; a second undo rejects with input/400.
    await expect(
      c.service.action(c.owner, c.ip, trail.id, trail.version, key(), {
        action: "undo",
      }),
    ).resolves.toMatchObject({
      steps: originalPath.map((id) => ({ entity: { id } })),
    });
  });
});
