import { expect, it, vi } from "vitest";
import { publicQueryCoordinator } from "../src/lib/core/public-query";
import { TurnTools } from "../src/lib/core/agent";
import { qlooPort } from "../src/lib/core/qloo";
import { setup } from "./helpers";

it("coalesces three cold sample subscribers and survives the initiating visitor cancelling", async () => {
  const query = publicQueryCoordinator();
  let finish!: (value: { names: string[] }) => void;
  const work = vi.fn(
    () =>
      new Promise<{ names: string[] }>((resolve) => {
        finish = resolve;
      }),
  );
  const abort = new AbortController();
  const first = query("same-sample", work, undefined, abort.signal);
  const second = query("same-sample", work);
  const third = query("same-sample", work);
  abort.abort();
  await expect(first).rejects.toMatchObject({ code: "cancelled" });
  finish({ names: ["a", "b", "c"] });
  expect(await second).toEqual(await third);
  expect(work).toHaveBeenCalledTimes(1);
});

it("hands a cold public result between separate coordinators through a shared lease", async () => {
  const values = new Map<string, unknown>();
  const redis = {
    get: async <T>(key: string) => (values.get(key) ?? null) as T | null,
    mget: async <T extends unknown[]>() => [] as unknown as T,
    set: async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    del: async (key: string) => values.delete(key),
    eval: async (_: string, keys: string[], args: (string | number)[]) => {
      if (values.get(keys[0]) === args[0]) values.delete(keys[0]);
      return 1;
    },
  };
  const work = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 80));
    return { ready: true };
  });
  const a = publicQueryCoordinator(),
    b = publicQueryCoordinator();
  const results = await Promise.all([
    a("sample", work, redis),
    b("sample", work, redis),
    b("sample", work, redis),
  ]);
  expect(results).toEqual([{ ready: true }, { ready: true }, { ready: true }]);
  expect(work).toHaveBeenCalledTimes(1);
  expect(values.has("rabbit-public:sample:lease")).toBe(false);
});

it("allows an automatic first direction beyond the advisory preference, records it, and preserves locks", async () => {
  const c = await setup();
  const trail = await c.storage.transact((db) => db.trails[c.trail.id]);
  const port = qlooPort({
    storage: c.storage,
    owner: c.owner,
    mode: "fixture",
  });
  const auto = new TurnTools(trail, "auto", false, port, async () => {});
  expect(auto.preferred).toBe("artist");
  await auto.discoverDoors("book");
  auto.publishDoors(auto.discovery!.entities.map((e) => e.id));
  expect(auto.published?.firstMedium).toBe("book");
  const locked = new TurnTools(trail, "artist", false, port, async () => {});
  await expect(locked.discoverDoors("book")).rejects.toThrow();
});

it.each([false, true])(
  "coalesces three cold live-adapter starts with cancellation=%s and charges one attempt",
  async (cancel) => {
    const activations = await import("../src/lib/core/activated-samples");
    const { MemoryStore } = await import("../src/lib/core/store");
    const { normalizeEntity } = await import("../src/lib/core/entities");
    const { entitySchema } = await import("../src/lib/qloo/schemas");
    const root = normalizeEntity(
      entitySchema.parse({
        entity_id: "eb000000-0000-4000-8000-000000000001",
        name: "Sample",
        types: ["urn:entity:movie"],
      }),
      "movie",
      new Date().toISOString(),
    );
    vi.stubEnv("QLOO_API_KEY", `r8-synthetic-transport-${cancel}`);
    vi.stubEnv("QLOO_DEV_CACHE_DIR", "");
    const activation = vi
      .spyOn(activations, "activatedSamples")
      .mockResolvedValue([root]);
    const storage = new MemoryStore();
    const fetcher = vi.fn<typeof fetch>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return Response.json({
        results: {
          entities: [
            {
              entity_id: "eb000000-0000-4000-8000-000000000002",
              name: "Artist",
              types: ["urn:entity:artist"],
            },
          ],
        },
      });
    });
    const controller = new AbortController();
    try {
      const ports = [0, 1, 2].map((i) =>
        qlooPort({
          storage,
          owner: `visitor-${i}`,
          mode: "live",
          fetch: fetcher,
          signal: i === 0 ? controller.signal : undefined,
        }),
      );
      const input = {
        anchor: root,
        medium: "artist" as const,
        exclusions: [root.id],
        lessObvious: false,
      };
      const results = ports.map((p) => p.insights(input));
      const settled = Promise.allSettled(results);
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (cancel) controller.abort();
      expect((await settled).map((r) => r.status)).toEqual([
        cancel ? "rejected" : "fulfilled",
        "fulfilled",
        "fulfilled",
      ]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        await storage.transact((db) =>
          Object.values(db.qloo).reduce((a, b) => a + b, 0),
        ),
      ).toBe(1);
    } finally {
      activation.mockRestore();
      vi.unstubAllEnvs();
    }
  },
);
