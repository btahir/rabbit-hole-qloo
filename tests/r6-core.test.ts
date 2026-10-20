import { afterEach, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { setup, generate, key } from "./helpers";
import {
  TurnTools,
  createBoundedAgent,
  runLocalGuide,
} from "../src/lib/core/agent";
import { qlooPort } from "../src/lib/core/qloo";
import { samples } from "../src/lib/core/fixtures";
import { AppError } from "../src/lib/core/errors";
import { QlooClient } from "../src/lib/qloo/client";
import { QlooError } from "../src/lib/qloo/errors";

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("keeps discovery order and preferences when the optional ranking seed is unavailable", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  trail.loves.push(samples[1]);
  const port = qlooPort({
    storage: c.storage,
    owner: c.owner,
    mode: "fixture",
  });
  const turn = new TurnTools(
    trail,
    "auto",
    false,
    {
      ...port,
      insights: async (input) => {
        if (input.candidates) throw new AppError("invalid_seed", 422);
        return port.insights(input);
      },
    },
    async () => {},
  );
  await runLocalGuide(turn);
  expect(turn.published?.pool).toEqual(turn.discovery?.entities);
  expect(turn.published?.personalRankingApplied).toBe(false);
  expect(turn.published?.warnings).toContain(
    "These doors use the starting point only. The favourites check didn't finish.",
  );
  expect(trail.loves).toHaveLength(2);
  expect(turn.calls).toBe(2);
});

it.each(["auth", "rate_limit", "timeout", "cancelled", "storage"] as const)(
  "stops the installed SDK after hydration %s, preserving adapter error details",
  async (kind) => {
    const c = await setup();
    const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
    const fixture = qlooPort({
      storage: c.storage,
      owner: c.owner,
      mode: "fixture",
    });
    vi.stubEnv("QLOO_API_KEY", "synthetic-test-key");
    const port = qlooPort({ storage: c.storage, owner: c.owner, mode: "live" });
    vi.spyOn(QlooClient.prototype, "getEntities").mockRejectedValue(
      kind === "storage"
        ? new AppError("storage", 503)
        : new QlooError(kind, "Synthetic failure", {
            status:
              kind === "auth" ? 401 : kind === "rate_limit" ? 429 : undefined,
            retryAfterMs: 5000,
          }),
    );
    const turn = new TurnTools(
      trail,
      "auto",
      false,
      {
        ...port,
        insights: async (input) => {
          const result = await fixture.insights(input);
          return {
            ...result,
            entities: result.entities.map((e) => ({
              ...e,
              description: undefined,
            })),
          };
        },
      },
      async () => {},
    );
    let steps = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        const n = ++steps;
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `step-${n}`,
              toolName:
                n === 1
                  ? "discoverDoors"
                  : n === 2
                    ? "describeEntities"
                    : "publishDoors",
              input: JSON.stringify(
                n === 1
                  ? { medium: "artist" }
                  : n === 2
                    ? {}
                    : {
                        connections: turn.discovery!.entities.map(
                          (e, index) => ({
                            door: index + 1,
                            sentence: `Try ${e.name}.`,
                          }),
                        ),
                      },
              ),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          warnings: [],
          usage,
        };
      },
    });
    await expect(
      createBoundedAgent(turn, model, async () => {}).generate({
        prompt: "Find doors",
      }),
    ).rejects.toMatchObject({
      code:
        kind === "auth"
          ? "configuration"
          : kind === "rate_limit"
            ? "limit"
            : kind,
    });
    expect(steps).toBe(2);
    expect(turn.published).toBeUndefined();
    if (kind === "rate_limit")
      expect((turn.fatal as AppError).retryAt).toBeGreaterThan(Date.now());
  },
);

it("branches away from a locked-empty recovery and undo restores its original direction", async () => {
  const c = await setup();
  const doors = await generate(c);
  const chosen = await c.service.action(
    c.owner,
    c.ip,
    doors.id,
    doors.version,
    key(),
    {
      action: "follow",
      generationId: doors.current!.id,
      entityId: doors.current!.pool[0].id,
    },
  );
  await c.storage.transact((db) => {
    db.trails[chosen.id].directionRequest = "movie";
  });
  const branch = await c.service.action(
    c.owner,
    c.ip,
    chosen.id,
    chosen.version,
    key(),
    { action: "branch", branchPoint: 0 },
  );
  expect(branch.directionRequest).toBeUndefined();
  expect(branch.steps).toHaveLength(0);
  const undo = await c.service.action(
    c.owner,
    c.ip,
    branch.id,
    branch.version,
    key(),
    { action: "undo" },
  );
  expect(undo.directionRequest).toBe("movie");
});

it("discloses a partial ranking without manufacturing scores for omitted candidates", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  trail.loves.push(samples[1]);
  const port = qlooPort({
    storage: c.storage,
    owner: c.owner,
    mode: "fixture",
  });
  const turn = new TurnTools(
    trail,
    "auto",
    false,
    {
      ...port,
      insights: async (input) => {
        const result = await port.insights(input);
        return input.candidates
          ? {
              entities: result.entities.slice(0, 2),
              evidence: {
                ...result.evidence,
                results: result.evidence.results.slice(0, 2),
              },
            }
          : result;
      },
    },
    async () => {},
  );
  await runLocalGuide(turn);
  expect(turn.published!.pool).toHaveLength(2);
  expect(turn.published!.warnings).toContain(
    `Qloo returned rankings for 2 of ${turn.discovery!.entities.length} candidates; the others remain unknown.`,
  );
});
