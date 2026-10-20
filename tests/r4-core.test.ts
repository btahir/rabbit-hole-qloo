import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setup, generate, key } from "./helpers";
import { normalizeEntity, safeInformationUrl } from "../src/lib/core/entities";
import { entitySchema } from "../src/lib/qloo/schemas";
import { publicGeneration } from "../src/lib/core/service";
import { EvidenceView } from "../src/components/evidence-view";
import { comparisonDifference, comparisons } from "../src/lib/core/comparisons";
import { activationSchema } from "../src/lib/core/activated-samples";
import * as activations from "../src/lib/core/activated-samples";
import { qlooPort } from "../src/lib/core/qloo";
import { MemoryStore, RETENTION } from "../src/lib/core/store";
import { visibleDoors } from "../src/lib/core/types";
import { api } from "../src/lib/core/http";
import { randomId, hash, signedSession } from "../src/lib/core/crypto";
import { TrailService } from "../src/lib/core/service";
import { samples } from "../src/lib/core/fixtures";
import { agentInput, RunService } from "../src/lib/core/runs";
import * as allowance from "../src/lib/core/qloo-allowance";
import { AppError } from "../src/lib/core/errors";
const id = "df000000-0000-4000-8000-000000000001";
const other = "df000000-0000-4000-8000-000000000002";
const spotify = "0123456789AbCdEfGhIjKl";
const checkedAt = "2026-10-19T00:00:00.000Z";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("maps typed artist identities to Spotify/MusicBrainz, never Goodreads books", () => {
  const row = {
    entity_id: id,
    name: "A musician",
    types: ["urn:entity:artist"],
    external: {
      spotify: [{ id: spotify }],
      goodreads: [{ id: "123" }],
      imdb: [{ id: "tt1234567" }],
    },
  };
  expect(
    normalizeEntity(entitySchema.parse(row), "artist", checkedAt)
      .informationUrl,
  ).toBe(`https://open.spotify.com/artist/${spotify}`);
  expect(
    normalizeEntity(
      entitySchema.parse({
        ...row,
        external: { musicbrainz: [{ id }], goodreads: [{ id: "123" }] },
      }),
      "artist",
      checkedAt,
    ).informationUrl,
  ).toBe(`https://musicbrainz.org/artist/${id}`);
  expect(
    normalizeEntity(
      entitySchema.parse({ ...row, external: { goodreads: [{ id: "123" }] } }),
      "artist",
      checkedAt,
    ).informationUrl,
  ).toBeUndefined();
  expect(
    normalizeEntity(
      entitySchema.parse({
        ...row,
        external: undefined,
        properties: { external: { spotify: { id: spotify } } },
      }),
      "artist",
      checkedAt,
    ).informationUrl,
  ).toContain("/artist/");
  for (const url of [
    `https://open.spotify.com/album/${spotify}`,
    `https://open.spotify.com/artist/${spotify}?tracking=x`,
    `https://open.spotify.com@evil.invalid/artist/${spotify}`,
    `https://musicbrainz.org/artist/not-a-uuid`,
  ])
    expect(safeInformationUrl(url)).toBeUndefined();
});

it("public and inherited evidence acknowledges private ordering without disclosing preferences", async () => {
  const c = await setup();
  let trail = await generate(c);
  const gen = trail.current!;
  gen.discovery.source = "qloo";
  gen.ranking = {
    ...structuredClone(gen.discovery),
    kind: "ranking",
    loves: [{ ...trail.root, name: "Private favourite" }],
  };
  const projected = publicGeneration(gen, gen.pool[0]);
  expect(projected.personalRankingApplied).toBe(true);
  expect(JSON.stringify(projected)).not.toContain("Private favourite");
  const html = renderToStaticMarkup(
    createElement(EvidenceView, {
      entity: gen.pool[0],
      generation: projected,
      publicView: true,
    }),
  );
  expect(html).toContain("private favourites affected the ordering");
  expect(html).not.toContain("This step used its starting point only");
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
  const share = await c.service.share(
    c.owner,
    c.ip,
    trail.id,
    trail.version,
    key(),
  );
  const fork = await c.service.fork(
    c.owner,
    c.ip,
    share.token,
    1,
    key(),
    false,
  );
  expect(fork.generations[0].inherited).toBe(true);
  expect(fork.loves).toEqual([]);
});

it("shares approved sample cache and hydration across visitors while isolating private queries", async () => {
  vi.stubEnv("QLOO_API_KEY", "synthetic-cache-scope-only");
  vi.stubEnv("QLOO_DEV_CACHE_DIR", "");
  const anchor = normalizeEntity(
    entitySchema.parse({
      entity_id: id,
      name: "Approved start",
      types: ["urn:entity:movie"],
    }),
    "movie",
    checkedAt,
  );
  const spy = vi
    .spyOn(activations, "activatedSamples")
    .mockResolvedValue([anchor]);
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    const rows = [
      { entity_id: other, name: "Result", types: ["urn:entity:artist"] },
    ];
    return Response.json({
      results: path.includes("insights") ? { entities: rows } : rows,
    });
  });
  const first = qlooPort({
    storage: new MemoryStore(),
    owner: key(),
    mode: "live",
    fetch: fetcher,
  });
  const second = qlooPort({
    storage: new MemoryStore(),
    owner: key(),
    mode: "live",
    fetch: fetcher,
  });
  const input = {
    anchor,
    medium: "artist" as const,
    exclusions: [id],
    lessObvious: false,
  };
  const a = await first.insights(input);
  const b = await second.insights(input);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(b.evidence.cache).toBe("hit");
  expect(b.evidence.checkedAt).toBe(a.evidence.checkedAt);
  await first.describeEntities([other], "artist");
  await second.describeEntities([other], "artist");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await first.resolveStart("private query", "artist");
  await second.resolveStart("private query", "artist");
  expect(fetcher).toHaveBeenCalledTimes(4);
  await first.insights({
    ...input,
    exclusions: [id, "df000000-0000-4000-8000-000000000003"],
  });
  await second.insights({
    ...input,
    exclusions: [id, "df000000-0000-4000-8000-000000000003"],
  });
  expect(fetcher).toHaveBeenCalledTimes(6);
  spy.mockRestore();
});

it("requires actual evidence references instead of fabricated activation flags", () => {
  const identity = normalizeEntity(
    entitySchema.parse({
      entity_id: id,
      name: "Start",
      types: ["urn:entity:movie"],
    }),
    "movie",
    checkedAt,
  );
  expect(
    activationSchema.safeParse({
      identity,
      activatedAt: checkedAt,
      identityConfirmed: true,
    }).success,
  ).toBe(false);
  const gate = { checkedAt, evidenceRefs: ["private-audit:case-1"] };
  const review = {
    entityId: id,
    identity: gate,
    discovery: gate,
    ranking: gate,
    exclusions: gate,
    popularity: gate,
    explanation: gate,
    outbound: gate,
  };
  expect(
    activationSchema.safeParse({ identity, activatedAt: checkedAt, review })
      .success,
  ).toBe(true);
  expect(
    activationSchema.safeParse({
      identity,
      activatedAt: checkedAt,
      review: { ...review, entityId: other },
    }).success,
  ).toBe(false);
});

it.each(["configuration", "paused", "storage"] as const)(
  "preserves credential %s failures without fetching upstream",
  async (code) => {
    vi.stubEnv("QLOO_API_KEY", "synthetic-allowance-test");
    vi.stubEnv("QLOO_DEV_CACHE_DIR", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(allowance, "reserveCredentialAttempt").mockRejectedValue(
      new AppError(code, 503),
    );
    const port = qlooPort({
      storage: new MemoryStore(),
      owner: key(),
      mode: "live",
    });
    await expect(
      port.resolveStart(`uncached-${code}`, "movie"),
    ).rejects.toMatchObject({ code });
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("reports pure ordering changes using condition labels independently of arm order", () => {
  const pair = structuredClone(comparisons[0]);
  pair.arms[1].entities = [...pair.arms[0].entities].reverse();
  const diff = comparisonDifference(pair);
  expect(diff).toContain("same doors in a different order");
  expect(diff).toContain("3 → 1");
  pair.arms.reverse();
  expect(comparisonDifference(pair)).toBe(diff);
});

it("renews an old session and HTTP cookie for a new fork without extending its source share", async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const storage = new MemoryStore();
  const service = new TrailService(storage);
  const raw = randomId(),
    owner = hash(raw);
  const global = globalThis as typeof globalThis & {
    rabbitStore?: import("../src/lib/core/store").AtomicStore;
  };
  const previous = global.rabbitStore;
  global.rabbitStore = storage;
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  vi.stubEnv("QLOO_MODE", "fixture");
  try {
    await service.session(owner, "ip");
    let trail = await service.create(owner, "ip", samples[0].id, key(), true);
    const runs = new RunService(storage);
    trail = await generate({ storage, service, runs, owner, ip: "ip", trail });
    trail = await service.action(owner, "ip", trail.id, trail.version, key(), {
      action: "follow",
      entityId: visibleDoors(trail)[0].id,
      generationId: trail.current!.id,
    });
    const share = await service.share(
      owner,
      "ip",
      trail.id,
      trail.version,
      key(),
    );
    vi.setSystemTime(start + 29 * 86400_000);
    const response = await api(
      "forks",
      new Request("http://localhost:3000/api/forks", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: `rabbit_session=${signedSession(raw)}`,
        },
        body: JSON.stringify({
          shareToken: share.token,
          branchPoint: 0,
          idempotencyKey: key(),
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=2592000");
    const fork = await response.json();
    expect(fork.expiresAt).toBe(Date.now() + RETENTION);
    vi.setSystemTime(start + RETENTION + 1000);
    const input = agentInput.parse({
      trailId: fork.id,
      expectedVersion: fork.version,
      intent: "generate",
      idempotencyKey: key(),
    });
    await expect(runs.begin(owner, "ip", input)).resolves.toMatchObject({
      started: true,
    });
    await expect(
      service.visitor(share.token, owner, "ip"),
    ).rejects.toMatchObject({ code: "missing" });
  } finally {
    global.rabbitStore = previous;
  }
});
