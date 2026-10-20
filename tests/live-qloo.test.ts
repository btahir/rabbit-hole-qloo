import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { entitySchema } from "../src/lib/qloo/schemas";
import { QlooClient, QLOO_ORIGIN } from "../src/lib/qloo/client";
import { DevDiskCache } from "../src/lib/qloo/dev-cache";
import { normalizeEntity, safeImageUrl } from "../src/lib/core/entities";
import { explanationProjection, qlooPort } from "../src/lib/core/qloo";
import { eligibleSuggestion } from "../src/lib/core/suggestion-policy";
import { MemoryStore } from "../src/lib/core/store";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const time = new Date().toISOString();
const wire = {
  entity_id: id.toUpperCase(),
  name: "A checked work",
  types: ["urn:entity:book"],
  properties: {
    publication_year: 1980,
    image: { url: "https://images.qloo.com/example.jpg" },
    external: { goodreads: { id: "12345" } },
  },
  disambiguation: "A. Writer",
  short_descriptions: [
    { languages: ["en"], value: "A factual short description." },
  ],
};
const entity = normalizeEntity(entitySchema.parse(wire), "book", time);
afterEach(() => vi.unstubAllEnvs());

it("decodes live category arrays, English metadata, nested identifiers and images without inventing authors", () => {
  expect(entity).toMatchObject({
    id,
    medium: "book",
    year: 1980,
    disambiguation: "A. Writer",
    description: "A factual short description.",
    informationUrl: "https://www.goodreads.com/book/show/12345",
    imageUrl: "https://images.qloo.com/example.jpg",
  });
  expect(entity.author).toBeUndefined();
  expect(() =>
    normalizeEntity(
      entitySchema.parse({ ...wire, subtype: "urn:entity:artist" }),
      "book",
      time,
    ),
  ).toThrow();
  expect(
    safeImageUrl("https://images.qloo.com@evil.example/image.jpg"),
  ).toBeUndefined();
});
it("retains a valid artist with a strict optional tag stub but rejects malformed identities", () => {
  const row = {
    entity_id: id,
    name: "Artist",
    types: ["urn:entity:artist"],
    tags: [{ type: "urn:tag:voice_type:qloo" }],
  };
  expect(normalizeEntity(entitySchema.parse(row), "artist", time).name).toBe(
    "Artist",
  );
  expect(
    entitySchema.safeParse({
      ...row,
      tags: [{ type: "urn:tag:voice_type:qloo", id: "bad" }],
    }).success,
  ).toBe(false);
});
it("decodes named row contributions and rejects foreign, duplicate and aggregate attribution", () => {
  const raw = (rows: unknown[]) => ({ "signal.interests.entities": rows });
  expect(
    explanationProjection(raw([{ entity_id: id.toUpperCase(), score: 1 }]), [
      entity,
    ]),
  ).toEqual({
    status: "returned",
    contributions: [{ entityId: id, value: 1 }],
  });
  for (const value of [
    raw([{ entity_id: other, score: 1 }]),
    raw([
      { entity_id: id, score: 0.5 },
      { entity_id: id.toUpperCase(), score: 0.5 },
    ]),
    {
      "signal.interests.entities": {
        effect_on_top3_recs: [{ entity_id: id, avg_score: 1 }],
      },
    },
  ])
    expect(explanationProjection(value, [entity]).status).toBe("unsupported");
});
it.each([200, 400])(
  "rejects required-seed failure at HTTP %i instead of offering fabricated discovery",
  async (status) => {
    vi.stubEnv("QLOO_API_KEY", "synthetic-key");
    const fetcher = vi.fn(async () =>
      Response.json(
        status === 200
          ? {
              results: {
                entities: [{ ...wire, types: ["urn:entity:artist"] }],
              },
              warnings: [
                {
                  type: "not_found",
                  "signal.interests.entities": [id.toUpperCase()],
                },
              ],
            }
          : {
              errors: [
                {
                  path: "signal.interests.entities",
                  message:
                    "All of the provided signal.interests.entities were invalid. At least one valid signal or filter is required for entity insights.",
                },
              ],
            },
        { status },
      ),
    );
    const port = qlooPort({
      storage: new MemoryStore(),
      owner: `invalid-${status}`,
      mode: "live",
      fetch: fetcher,
    });
    await expect(
      port.insights({
        anchor: entity,
        medium: "artist",
        exclusions: [],
        lessObvious: false,
      }),
    ).rejects.toMatchObject({ code: "invalid_seed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it("filters inappropriate or unusable suggestions while retaining explicit identity lookup", () => {
  expect(
    eligibleSuggestion(entitySchema.parse({ ...wire, name: "Lolita" })),
  ).toBe(false);
  expect(
    normalizeEntity(
      entitySchema.parse({ ...wire, name: "Lolita" }),
      "book",
      time,
    ).name,
  ).toBe("Lolita");
  for (const rating of [undefined, "R", 1])
    expect(
      eligibleSuggestion(
        entitySchema.parse({
          ...wire,
          types: ["urn:entity:movie"],
          properties: { content_rating: rating },
        }),
      ),
    ).toBe(false);
  expect(
    eligibleSuggestion(
      entitySchema.parse({
        ...wire,
        types: ["urn:entity:movie"],
        properties: { content_rating: "PG-13" },
      }),
    ),
  ).toBe(true);
});
it("reuses validated disk data across clients and sessions with original timestamps and no extra attempts", async () => {
  await mkdir(".cache", { recursive: true });
  const directory = await mkdtemp(".cache/disk-test-");
  try {
    const fetcher = vi.fn(async () => Response.json({ results: [wire] }));
    const client = (namespace: string) =>
      new QlooClient({
        origin: QLOO_ORIGIN,
        apiKey: "synthetic-key",
        cacheNamespace: namespace,
        devCache: new DevDiskCache(directory),
        transport: { mode: "live", fetch: fetcher },
      });
    const query = { query: "work", types: ["urn:entity:book" as const] };
    const first = await client("owner-a").searchEntities(query);
    const second = await client("owner-b").searchEntities(query);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.provenance).toMatchObject({
      cache: "hit",
      attempts: 0,
      fetchedAt: first.provenance.fetchedAt,
    });
    const key = new DevDiskCache(directory).key("/search", query);
    expect(
      await readFile(join(directory, `${key}.json`), "utf8"),
    ).not.toContain("synthetic-key");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("atomically reserves the final development attempt and paces separate cache instances", async () => {
  await mkdir(".cache", { recursive: true });
  const directory = await mkdtemp(".cache/pacing-test-");
  try {
    const a = new DevDiskCache(directory),
      b = new DevDiskCache(directory);
    await Promise.all([
      a.reserveAttempt("/search"),
      b.reserveAttempt("/entities"),
    ]);
    const records = (await readFile(join(directory, "attempts.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      Date.parse(records[1].at) - Date.parse(records[0].at),
    ).toBeGreaterThanOrEqual(250);
    await writeFile(
      join(directory, "attempts.jsonl"),
      (JSON.stringify(records[0]) + "\n").repeat(149),
    );
    const final = await Promise.allSettled([
      a.reserveAttempt("/search"),
      b.reserveAttempt("/search"),
    ]);
    expect(final.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (await readFile(join(directory, "attempts.jsonl"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(150);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("keeps a successful paid response in memory if the optional disk cache cannot write", async () => {
  const disk = new DevDiskCache(".cache/unused-test-path");
  vi.spyOn(disk, "get").mockResolvedValue(undefined);
  vi.spyOn(disk, "set").mockRejectedValue(new Error("disk full"));
  const fetcher = vi.fn(async () => Response.json({ results: [wire] }));
  const client = new QlooClient({
    origin: QLOO_ORIGIN,
    apiKey: "synthetic-key",
    devCache: disk,
    transport: { mode: "live", fetch: fetcher },
  });
  const query = { query: "work", types: ["urn:entity:book" as const] };
  expect((await client.searchEntities(query)).provenance).toMatchObject({
    attempts: 1,
    cache: "miss",
  });
  expect((await client.searchEntities(query)).provenance).toMatchObject({
    attempts: 0,
    cache: "hit",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([undefined, "0.25"])(
  "backs off a 429 with Retry-After %s and counts both HTTP attempts",
  async (retryAfter) => {
    const sleeper = vi
      .fn<(ms: number, signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Rate limit exceeded", {
          status: 429,
          headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
        }),
      )
      .mockResolvedValueOnce(Response.json({ results: [wire] }));
    const client = new QlooClient({
      origin: QLOO_ORIGIN,
      apiKey: "synthetic-key",
      transport: { mode: "live", fetch: fetcher },
      sleep: sleeper,
    });
    const result = await client.searchEntities({ query: "work" });
    expect(sleeper.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    expect(result.provenance.attempts).toBe(2);
  },
);
