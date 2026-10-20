import { describe, expect, it, vi } from "vitest";
import { body, sameOrigin, fail } from "../src/lib/core/http";
import { z } from "zod";
import { normalizeEntity, safeInformationUrl } from "../src/lib/core/entities";
import { qlooPort } from "../src/lib/core/qloo";
import { MemoryStore } from "../src/lib/core/store";
import { entitySchema } from "../src/lib/qloo/schemas";
import { AppError } from "../src/lib/core/errors";
const url = "http://localhost:3000/api/search";
const request = (data: string, extra: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...extra,
    },
    body: data,
  });
describe("request/error boundaries", () => {
  it("blocks cross-site origins, fetch metadata, oversize streaming bodies and extra fields", async () => {
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    expect(() =>
      sameOrigin(request("{}", { origin: "https://evil.invalid" })),
    ).toThrow();
    expect(() =>
      sameOrigin(request("{}", { "sec-fetch-site": "cross-site" })),
    ).toThrow();
    await expect(
      body(request("x".repeat(16_385)), z.object({})),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      body(
        request('{"query":"ok","model":"injected"}'),
        z.object({ query: z.string() }).strict(),
      ),
    ).rejects.toMatchObject({ code: "input" });
    await expect(
      body(request("{not-json"), z.object({})),
    ).rejects.toMatchObject({ code: "input" });
    expect(
      fail(new AppError("limit", 429, Date.now() + 5000)).headers.get(
        "retry-after",
      ),
    ).toBe("5");
  });
  it("validates identity/category, keeps zero scores and never confuses images with information URLs", () => {
    const raw = entitySchema.parse({
      id: "10000000-0000-4000-8000-000000000001",
      name: "<script>untrusted</script>",
      subtype: "urn:entity:movie",
      url: "https://images.qloo.com/poster.jpg",
      properties: { release_year: 2000 },
      affinity: 0,
    });
    const entity = normalizeEntity(raw, "movie", "2026-10-17T00:00:00Z");
    expect(entity.informationUrl).toBeUndefined();
    expect(entity.name).toContain("<script>");
    expect(() => normalizeEntity(raw, "book", entity.checkedAt)).toThrow();
    for (const unsafe of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "https://evil.invalid/",
      "https://user:pass@www.imdb.com/title/tt1234567/",
    ])
      expect(safeInformationUrl(unsafe)).toBeUndefined();
    expect(
      safeInformationUrl("https://www.imdb.com/title/tt1234567/"),
    ).toBeTruthy();
  });
  it("fixture transport never calls an external provider, and unknown fixture inputs stay empty", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const port = qlooPort({
      storage: new MemoryStore(),
      owner: "test",
      mode: "fixture",
      fetch: fetcher,
    });
    expect(await port.resolveStart("unlisted-example", "movie")).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500, 502])(
    "live HTTP %i never silently becomes a synthetic success",
    async (status) => {
      vi.stubEnv("QLOO_API_KEY", "synthetic-test-credential");
      vi.stubEnv("QLOO_DAILY_ATTEMPTS", "500");
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response("upstream failure", { status }),
      );
      const port = qlooPort({
        storage: new MemoryStore(),
        owner: `test-${status}`,
        mode: "live",
        fetch: fetcher,
      });
      await expect(port.resolveStart("test", "movie")).rejects.toBeInstanceOf(
        AppError,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "<html>failure</html>",
    '{"success":false,"results":[]}',
    '{"results":{}}',
  ])(
    "rejects invalid upstream contracts instead of returning empty results: %s",
    async (response) => {
      vi.stubEnv("QLOO_API_KEY", "synthetic-test-credential");
      vi.stubEnv("QLOO_DAILY_ATTEMPTS", "500");
      const port = qlooPort({
        storage: new MemoryStore(),
        owner: `test-${response}`,
        mode: "live",
        fetch: async () => new Response(response, { status: 200 }),
      });
      await expect(port.resolveStart("test", "movie")).rejects.toMatchObject({
        code: "contract",
      });
    },
  );
});

describe("partial Insights records and truthful positions", () => {
  it("keeps usable rows in original order, flags omissions, and never accepts a wholly malformed collection", async () => {
    const { normalizePartialCollection } = await import("../src/lib/core/qloo");
    const good = {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Valid film",
      subtype: "urn:entity:movie",
    };
    const partial = {
      results: { entities: [{ name: "Missing identity" }, good] },
    };
    normalizePartialCollection(partial);
    expect(partial.results.entities).toHaveLength(1);
    expect(partial.results.entities[0]).toHaveProperty(
      "rabbitOriginalPosition",
      2,
    );
    const bad = { results: { entities: [{ name: "Missing identity" }] } };
    normalizePartialCollection(bad);
    const { entityInsightsResponseSchema } =
      await import("../src/lib/qloo/schemas");
    expect(entityInsightsResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe("live policy failures", () => {
  it("keeps quota-store failure distinct and fails closed before external fetch", async () => {
    vi.stubEnv("QLOO_API_KEY", "synthetic-test-credential");
    vi.stubEnv("QLOO_DAILY_ATTEMPTS", "500");
    const fetcher = vi.fn<typeof fetch>();
    const port = qlooPort({
      storage: {
        transact: async () => {
          throw new AppError("storage", 503);
        },
      },
      owner: "test-storage",
      mode: "live",
      fetch: fetcher,
    });
    await expect(
      port.resolveStart("another-test-query", "movie"),
    ).rejects.toMatchObject({ code: "storage" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
