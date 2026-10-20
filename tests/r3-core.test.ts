import { it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setup, generate, key } from "./helpers";
import { MemoryStore } from "../src/lib/core/store";
import { qlooPort } from "../src/lib/core/qloo";
import { TurnTools } from "../src/lib/core/agent";
import { comparisons } from "../src/lib/core/comparisons";
import { evaluationId } from "../src/lib/core/evaluation-id";
import { EvidenceView } from "../src/components/evidence-view";
import { agentInput } from "../src/lib/core/runs";
afterEach(() => vi.unstubAllEnvs());
const uuid = (i: number) =>
  `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const anchor = {
  id: uuid(1000),
  name: "Anchor",
  medium: "movie" as const,
  source: "Qloo" as const,
  checkedAt: "2026-10-17T00:00:00.000Z",
  schemaVersion: 1 as const,
};
it.each([50, 51, 96])(
  "sends at most 50 exclusions and locally checks all %i, preserving response positions",
  async (count) => {
    const c = await setup();
    vi.stubEnv("QLOO_API_KEY", "synthetic-test-only");
    vi.stubEnv("QLOO_DAILY_ATTEMPTS", "500");
    const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const query = new URL(String(url));
      expect(
        query.searchParams.get("filter.exclude.entities")!.split(","),
      ).toHaveLength(50);
      return Response.json({
        results: {
          entities: [
            {
              entity_id: uuid(count - 1),
              name: "Explicitly skipped",
              type: "urn:entity:artist",
            },
            {
              entity_id: uuid(2000),
              name: "Eligible",
              type: "urn:entity:artist",
            },
          ],
        },
      });
    });
    const port = qlooPort({
      storage: new MemoryStore(),
      owner: key(),
      mode: "live",
      fetch: fetcher,
    });
    const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
    trail.root = anchor;
    trail.mode = "live";
    trail.excluded = Array.from({ length: count - 1 }, (_, i) => ({
      entity: { ...anchor, id: uuid(i) },
      reason: "reject" as const,
    }));
    // TurnTools adds the anchor and forwards a successive-refinement exclusion set.
    const turn = new TurnTools(trail, "artist", false, port, async () => {});
    // Include the last explicit ID beyond the transmitted subset when count > 50.
    trail.excluded.push({
      entity: { ...anchor, id: uuid(count - 1) },
      reason: "known",
    });
    const result = await port.insights({
      anchor,
      medium: "artist",
      exclusions: Array.from({ length: count }, (_, i) => uuid(i)),
      lessObvious: false,
    });
    expect(result.entities.map((e) => e.id)).toEqual([uuid(2000)]);
    expect(result.evidence).toMatchObject({
      exclusionsCount: count,
      upstreamExclusionsCount: 50,
      localExclusionsCount: count,
    });
    expect(result.evidence.results[0].position).toBe(2);
    await turn.discoverDoors("artist");
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);
it("binds comparison versions to arm outputs, failures, model and constraints even with the same freeze time", () => {
  const item = structuredClone(comparisons[0]);
  const original = evaluationId(item);
  for (const change of [
    (c: typeof item) => {
      c.arms[0].entities = c.catalog.slice(0, 2);
    },
    (c: typeof item) => {
      c.arms[0].status = "failed";
    },
    (c: typeof item) => {
      c.model = "different-verified-model";
    },
    (c: typeof item) => {
      c.constraints.excluded.push("another-exclusion");
    },
  ]) {
    const changed = structuredClone(item);
    change(changed);
    expect(evaluationId(changed)).not.toBe(original);
  }
});
it("renders unsupported and ranking explanations truthfully and keeps private contributions out of public evidence", async () => {
  const c = await setup(),
    t = await generate(c),
    generation = t.current!,
    entity = generation.pool[0];
  generation.discovery.source = "qloo";
  generation.discovery.results[0].explanation = {
    status: "unsupported",
    contributions: [],
  };
  generation.ranking = {
    ...structuredClone(generation.discovery),
    kind: "ranking",
    loves: [generation.anchor],
    results: [
      {
        id: entity.id,
        position: 1,
        explanation: {
          status: "returned",
          contributions: [{ entityId: generation.anchor.id, value: 0.739 }],
        },
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(EvidenceView, { entity, generation }),
  );
  expect(html).toContain("format this view cannot display");
  expect(html).not.toContain("return a detailed explanation");
  expect(html).toContain("0.739");
  expect(
    renderToStaticMarkup(
      createElement(EvidenceView, { entity, generation, publicView: true }),
    ),
  ).not.toContain("0.739");
});
it("finalizes operator comparisons with their actual prompt, aggregate tokens, time and conservative cost exactly once", async () => {
  const c = await setup();
  const input = agentInput.parse({
    trailId: c.trail.id,
    expectedVersion: 1,
    intent: "generate",
    idempotencyKey: key(),
  });
  const accepted = await c.runs.begin(c.owner, c.ip, input, {
    promptVersion: "comparison-guide-1",
  });
  await c.runs.finishComparison(c.owner, accepted.run.id, {
    inputTokens: 30,
    outputTokens: 20,
  });
  await c.runs.finishComparison(c.owner, accepted.run.id, { inputTokens: 999 });
  const run = await c.runs.read(c.owner, accepted.run.id);
  expect(run.telemetry).toMatchObject({
    promptVersion: "comparison-guide-1",
    inputTokens: 30,
    outputTokens: 20,
    costStatus: "unknown",
  });
  expect(run.state).toBe("committed");
  expect(run.elapsedMs).toBeGreaterThanOrEqual(0);
});
it.each([
  "trails",
  "actions",
  "shares",
  "forks",
  "votes",
  "saveResult",
  "delete",
] as const)(
  "public %s replays are bounded with an actual 429 and Retry-After",
  async (kind) => {
    const { api } = await import("../src/lib/core/http");
    const { TrailService } = await import("../src/lib/core/service");
    const { RunService } = await import("../src/lib/core/runs");
    const { randomId, hash, signedSession } =
      await import("../src/lib/core/crypto");
    const { samples } = await import("../src/lib/core/fixtures");
    const global = globalThis as typeof globalThis & {
      rabbitStore?: import("../src/lib/core/store").AtomicStore;
    };
    const previous = global.rabbitStore;
    const storage = new MemoryStore();
    global.rabbitStore = storage;
    const service = new TrailService(storage),
      runs = new RunService(storage),
      raw = randomId(),
      owner = hash(raw),
      ip = "route-ip";
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.stubEnv("QLOO_MODE", "fixture");
    try {
      await service.session(owner, ip);
      let trail = await service.create(
        owner,
        ip,
        samples[0].id,
        "public-create-key",
        true,
      );
      const input = agentInput.parse({
        trailId: trail.id,
        expectedVersion: 1,
        intent: "generate",
        idempotencyKey: key(),
      });
      const accepted = await runs.begin(owner, ip, input);
      await runs.execute(
        owner,
        accepted.run.id,
        input,
        accepted.trail,
        () => {},
      );
      trail = await service.read(owner, trail.id);
      const choice = {
        action: "follow",
        entityId: trail.current!.pool[0].id,
        generationId: trail.current!.id,
      };
      const version = trail.version;
      if (kind !== "actions")
        trail = await service.action(
          owner,
          ip,
          trail.id,
          version,
          key(),
          choice as never,
        );
      const share =
        kind === "forks"
          ? await service.share(owner, ip, trail.id, trail.version, key())
          : undefined;
      const pair = comparisons[0];
      const values = {
        trails: {
          entityId: samples[0].id,
          sample: true,
          idempotencyKey: "public-create-key",
        },
        actions: {
          expectedVersion: version,
          idempotencyKey: "public-follow-key",
          choice,
        },
        shares: {
          expectedVersion: trail.version,
          idempotencyKey: "public-share-key",
        },
        forks: {
          shareToken: share?.token,
          branchPoint: 0,
          loveStartingPoint: false,
          idempotencyKey: "public-fork-key",
        },
        votes: {
          choice: "Both",
          caseVersion: evaluationId(pair),
          familiarity: [],
          armOrder: ["with", "without"],
          idempotencyKey: "public-vote-key",
        },
        saveResult: {
          trailId: trail.id,
          expectedVersion: trail.version,
          runId: accepted.run.id,
          intent: "saveResult",
          idempotencyKey: "public-save-key",
        },
        delete: {
          expectedVersion: trail.version,
          idempotencyKey: "public-delete-key",
        },
      };
      let limited: Response | undefined;
      let successes = 0;
      for (let i = 0; i < 65; i++) {
        const response = await api(
          kind === "saveResult" ? "agent" : kind === "delete" ? "trail" : kind,
          new Request("http://localhost:3000/api/test", {
            method: kind === "delete" ? "DELETE" : "POST",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              cookie: `rabbit_session=${signedSession(raw)}`,
            },
            body: JSON.stringify(values[kind]),
          }),
          { id: trail.id, caseId: pair.id },
        );
        if (response.status === 429) {
          limited = response;
          break;
        }
        if (response.ok) successes++;
      }
      expect(limited?.status).toBe(429);
      expect(Number(limited?.headers.get("Retry-After"))).toBeGreaterThan(0);
      if (kind !== "saveResult") expect(successes).toBeGreaterThan(0);
      expect(successes).toBeLessThanOrEqual(60);
    } finally {
      global.rabbitStore = previous;
    }
  },
);
it("a route rejects a stale vote after arm content changes without changing the input timestamp", async () => {
  const { api } = await import("../src/lib/core/http");
  const saved = await import("../src/lib/core/saved-comparisons");
  const { randomId, hash, signedSession } =
    await import("../src/lib/core/crypto");
  const { TrailService } = await import("../src/lib/core/service");
  const global = globalThis as typeof globalThis & {
    rabbitStore?: import("../src/lib/core/store").AtomicStore;
  };
  const previous = global.rabbitStore,
    storage = new MemoryStore();
  global.rabbitStore = storage;
  const item = structuredClone(comparisons[0]),
    original = evaluationId(item),
    raw = randomId();
  item.arms[0].entities = item.catalog.slice(0, 2);
  item.evaluationId = evaluationId(item);
  const spy = vi.spyOn(saved, "savedComparisons").mockResolvedValue([item]);
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  try {
    await new TrailService(storage).session(hash(raw), "ip");
    const response = await api(
      "votes",
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: `rabbit_session=${signedSession(raw)}`,
        },
        body: JSON.stringify({
          choice: "Left",
          caseVersion: original,
          familiarity: [],
          armOrder: ["with", "without"],
          idempotencyKey: key(),
        }),
      }),
      { caseId: item.id },
    );
    expect(response.status).toBe(409);
  } finally {
    spy.mockRestore();
    global.rabbitStore = previous;
  }
});
