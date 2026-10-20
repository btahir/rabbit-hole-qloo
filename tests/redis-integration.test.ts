import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  spawn,
  spawnSync,
  execFileSync,
  type ChildProcess,
} from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdirSync, rmSync } from "node:fs";
import { setup, generate, key } from "./helpers";
import { visibleDoors } from "../src/lib/core/types";
import { RedisStore, redisClient } from "../src/lib/core/store";
import { TrailService } from "../src/lib/core/service";
import { samples } from "../src/lib/core/fixtures";
import { reserve, dayKey } from "../src/lib/core/limits";
import type { Run } from "../src/lib/core/types";
const available =
  spawnSync("redis-server", ["--version"], { stdio: "ignore" }).status === 0;
const socket = `.cache/redis-core-test-${process.pid}.sock`;
let child: ChildProcess;
let tcpPort: number;
function command(...args: string[]): unknown {
  return JSON.parse(
    execFileSync("redis-cli", ["-s", socket, "--json", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
  );
}
const decode = (value: unknown) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const redis = {
  get: async (key: string) => decode(command("GET", key)),
  set: async (
    key: string,
    value: unknown,
    options?: { nx?: boolean; px?: number },
  ) =>
    command(
      "SET",
      key,
      typeof value === "string" ? value : JSON.stringify(value),
      ...(options?.nx ? ["NX"] : []),
      ...(options?.px ? ["PX", String(options.px)] : []),
    ),
  mget: async (...keys: string[]) =>
    (command("MGET", ...keys) as unknown[]).map(decode),
  eval: async (script: string, keys: string[], args: unknown[]) =>
    command("EVAL", script, String(keys.length), ...keys, ...args.map(String)),
  del: async (key: string) => command("DEL", key),
};
describe.skipIf(!available)("actual local Redis Lua and retention", () => {
  beforeAll(async () => {
    mkdirSync(".cache", { recursive: true });
    const { createServer } = await import("node:net");
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    tcpPort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    child = spawn(
      "redis-server",
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(tcpPort),
        "--unixsocket",
        socket,
        "--save",
        "",
        "--appendonly",
        "no",
        "--pidfile",
        ".cache/redis-core-test.pid",
      ],
      { stdio: "ignore" },
    );
    for (let i = 0; i < 100; i++) {
      try {
        if (command("PING") === "PONG") return;
      } catch {
        /* wait for our private socket */
      }
      await delay(10);
    }
    throw new Error("Private Redis test socket did not start.");
  });
  afterAll(async () => {
    try {
      command("SHUTDOWN", "NOSAVE");
    } catch {
      /* server closes connection on shutdown */
    }
    child?.kill();
    rmSync(socket, { force: true });
    rmSync(".cache/redis-core-test.pid", { force: true });
  });
  it("uses ShipTiffin KV with project prefixes for records, Lua and cache", async () => {
    const { vi } = await import("vitest");
    const { boundedRedisCache } = await import("../src/lib/core/cache");
    vi.stubEnv("REDIS_URL", `redis://127.0.0.1:${tcpPort}`);
    vi.stubEnv("VALKEY_PREFIX", "p_rabbit_test:");
    try {
      const client = redisClient()!;
      await client.get("sdk-probe");
      const { publicQueryCoordinator } =
        await import("../src/lib/core/public-query");
      const a = publicQueryCoordinator(),
        b = publicQueryCoordinator();
      let count = 0;
      const work = async () => {
        count++;
        await delay(80);
        return { ready: true };
      };
      expect(
        await Promise.all([
          a("sdk-public-test", work, client),
          b("sdk-public-test", work, client),
        ]),
      ).toEqual([{ ready: true }, { ready: true }]);
      expect(count).toBe(1);
      expect(
        await client.get("rabbit-public:sdk-public-test:lease"),
      ).toBeNull();
      const storage = new RedisStore(client, "sdk:core");
      await storage.transact((db) => {
        db.circuitUntil = 123;
      });
      expect(await storage.transact((db) => db.circuitUntil)).toBe(123);
      const service = new TrailService(storage);
      await service.session("sdk-owner", "sdk-ip");
      const trail = await service.create(
        "sdk-owner",
        "sdk-ip",
        samples[0].id,
        "sdk-create-1",
        true,
      );
      expect((await service.read("sdk-owner", trail.id)).root.name).toBe(
        samples[0].name,
      );
      expect(command("GET", `sdk:core:trails:${trail.id}`)).toBeNull();
      expect(command("PTTL", `p_rabbit_test:sdk:core:trails:${trail.id}`)).toBe(
        -1,
      );
      await storage.admit("sdk-owner", "sdk-ip", "read", Date.now());
      const cache = boundedRedisCache(client, "sdk-test");
      await cache.set(
        "sdk-cache",
        { value: { name: "synthetic" }, fetchedAt: new Date().toISOString() },
        10000,
      );
      expect(await cache.get("sdk-cache")).toBeDefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("serves warmed public queries to a second owner through actual Redis without the dev cache", async () => {
    const { vi } = await import("vitest");
    const stores = await import("../src/lib/core/store");
    const activations = await import("../src/lib/core/activated-samples");
    const { qlooPort } = await import("../src/lib/core/qloo");
    vi.stubEnv("QLOO_API_KEY", "synthetic-redis-cache-only");
    vi.stubEnv("QLOO_DEV_CACHE_DIR", "");
    vi.stubEnv("ENTITLEMENT_NAMESPACE", "r4-production-cache");
    vi.spyOn(stores, "redisClient").mockReturnValue(redis as never);
    const root = { ...samples[0], id: "ea000000-0000-4000-8000-000000000001" };
    vi.spyOn(activations, "activatedSamples").mockResolvedValue([root]);
    const resultId = "ea000000-0000-4000-8000-000000000002";
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      Response.json({
        results:
          new URL(String(url)).pathname === "/entities"
            ? [
                {
                  entity_id: resultId,
                  name: "Artist",
                  types: ["urn:entity:artist"],
                },
              ]
            : {
                entities: [
                  {
                    entity_id: resultId,
                    name: "Artist",
                    types: ["urn:entity:artist"],
                  },
                ],
              },
      }),
    );
    try {
      const first = qlooPort({
        storage: new stores.MemoryStore(),
        owner: "first",
        mode: "live",
        fetch: fetcher,
      });
      const second = qlooPort({
        storage: new stores.MemoryStore(),
        owner: "second",
        mode: "live",
        fetch: fetcher,
      });
      const input = {
        anchor: root,
        medium: "artist" as const,
        exclusions: [root.id],
        lessObvious: false,
      };
      const cold = await first.insights(input);
      const warm = await second.insights(input);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(warm.evidence.cache).toBe("hit");
      expect(warm.evidence.checkedAt).toBe(cold.evidence.checkedAt);
      await first.describeEntities([resultId], "artist");
      await second.describeEntities([resultId], "artist");
      expect(fetcher).toHaveBeenCalledTimes(2);
      const privateInput = {
        ...input,
        exclusions: [root.id, "ea000000-0000-4000-8000-000000000003"],
      };
      await first.insights(privateInput);
      await second.insights(privateInput);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });
  it("preserves empty arrays and stores sensitive records outside the revision document with application retention and no evictable TTL", async () => {
    const storage = new RedisStore(redis as never, "test:retention"),
      service = new TrailService(storage);
    await service.session("owner", "ip");
    const trail = await service.create(
      "owner",
      "ip",
      samples[0].id,
      "create-key-0001",
      true,
    );
    const result = await service.read("owner", trail.id);
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.steps).toEqual([]);
    const metadata = String(command("GET", "test:retention"));
    expect(metadata).not.toContain(trail.root.name);
    const recordKey = `test:retention:trails:${trail.id}`;
    const ttl = Number(command("PTTL", recordKey));
    expect(ttl).toBe(-1); // Durable KV keys cannot be evicted as expiring cache.
    await storage.transact((db) => {
      db.trails[trail.id].expiresAt = Date.now() + 50;
    });
    await delay(100);
    await expect(service.read("owner", trail.id)).rejects.toMatchObject({
      code: "owner",
    });
    await storage.transact(() => {});
    expect(command("GET", recordKey)).toBeNull();
  });
  it("32 unrelated reads do not contend and atomic admission never touches the product revision", async () => {
    let evaluations = 0;
    const adapter = {
      ...redis,
      eval: async (script: string, keys: string[], args: unknown[]) => {
        evaluations++;
        return redis.eval(script, keys, args);
      },
    };
    const storage = new RedisStore(adapter as never, "test:parallel-reads");
    await storage.transact((db) => {
      db.circuitUntil = 123;
    });
    const revision = (
      (await redis.get("test:parallel-reads")) as { revision: number }
    ).revision;
    evaluations = 0;
    const reads = await Promise.all(
      Array.from({ length: 32 }, () =>
        storage.transact((db) => db.circuitUntil),
      ),
    );
    expect(reads).toEqual(Array(32).fill(123));
    expect(evaluations).toBe(0);
    await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        storage.admit(`owner-${index}`, `ip-${index}`, "read", Date.now()),
      ),
    );
    expect(
      ((await redis.get("test:parallel-reads")) as { revision: number })
        .revision,
    ).toBe(revision);
    let limited = false;
    for (let i = 0; i < 61; i++) {
      try {
        await storage.admit("repeat", "repeat-ip", "replay", Date.now());
      } catch (error) {
        expect(error).toMatchObject({ code: "limit", status: 429 });
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
  it("actual Lua CAS prevents cross-instance spending races", async () => {
    const first = new RedisStore(redis as never, "test:spend"),
      second = new RedisStore(redis as never, "test:spend");
    const { vi } = await import("vitest");
    vi.stubEnv("DAILY_BUDGET_USD", "0.04");
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? first : second).transact((db) => {
          const now = Date.now(),
            trail = {
              id: `${i}`,
              counters: { runs: 0, insights: 0, attempts: 0 },
            } as never;
          const run = {
            id: `${i}`,
            owner: `${i}`,
            state: "reserved",
            leaseUntil: now + 60_000,
            expiresAt: now + 86400_000,
            reserved: 20_000,
            day: dayKey(now),
          } as Run;
          reserve(db, trail, run, `${i}`, now);
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await first.transact((db) => db.budgets.cumulative)).toBe(40_000);
  });
  it("retains 100 complete trails, reads only the requested body and changes no unrelated body during concurrent writes", async () => {
    const c = await setup();
    let completed = c.trail;
    for (let i = 0; i < 3; i++) {
      completed = await generate(c, completed);
      const entity = visibleDoors(completed)[0];
      completed = await c.service.action(
        c.owner,
        c.ip,
        completed.id,
        completed.version,
        key(),
        {
          action: "follow",
          entityId: entity.id,
          generationId: completed.current!.id,
        },
      );
    }
    const source = await c.storage.transact((db) => db.trails[completed.id]);
    const gets: string[] = [],
      changed: number[] = [];
    const adapter = {
      ...redis,
      get: async (name: string) => {
        gets.push(name);
        return redis.get(name);
      },
      eval: async (script: string, keys: string[], args: unknown[]) => {
        if (keys.length === 1) changed.push(JSON.parse(String(args[1])).length);
        return redis.eval(script, keys, args);
      },
    };
    const storage = new RedisStore(adapter as never, "test:capacity"),
      second = new RedisStore(adapter as never, "test:capacity");
    for (let batch = 0; batch < 10; batch++)
      await storage.transact((db) => {
        for (let i = batch * 10; i < (batch + 1) * 10; i++)
          db.trails[`retained-${i}`] = {
            ...structuredClone(source),
            id: `retained-${i}`,
            owner: `owner-${i}`,
          };
      });
    gets.length = 0;
    changed.length = 0;
    const one = await new TrailService(storage).read("owner-50", "retained-50");
    expect(one.steps).toHaveLength(3);
    expect(gets.filter((name) => name.includes(":trails:"))).toEqual([
      "test:capacity:trails:retained-50",
    ]);
    expect(changed).toEqual([]);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        new TrailService(i % 2 ? storage : second).action(
          `owner-${i}`,
          `ip-${i}`,
          `retained-${i}`,
          source.version,
          key(),
          { action: "save", entityId: source.root.id },
        ),
      ),
    );
    expect(
      (await new TrailService(second).read("owner-99", "retained-99")).version,
    ).toBe(source.version);
    expect(await storage.transact((db) => Object.keys(db.trails).length)).toBe(
      100,
    );
    const bytes = Number(command("STRLEN", "test:capacity:trails:retained-50"));
    expect(bytes).toBeLessThan(JSON.stringify(source).length / 2);
    console.log(
      JSON.stringify({
        retainedTrails: 100,
        originalTrailBytes: Buffer.byteLength(JSON.stringify(source)),
        normalizedTrailBytes: bytes,
        requestedTrailBodies: 1,
        unchangedBodyWrites: 0,
        concurrentUpdates: 8,
      }),
    );
  }, 20_000);
});

// Same raw key is deliberately used by simulated application clients.
describe.skipIf(!available)("credential allowance contract", () => {
  // Reuse the tested Lua transport without any real Qloo calls.
  it("uses one atomic ledger for development reserve, judging and immutable configuration", async () => {
    const { RESERVE_CREDENTIAL_ATTEMPT, PROVISION_ALLOWANCE } =
      await import("../src/lib/core/qloo-allowance");
    const testSocket = `.cache/quota-${process.pid}.sock`;
    const server = spawn(
      "redis-server",
      [
        "--port",
        "0",
        "--unixsocket",
        testSocket,
        "--save",
        "",
        "--appendonly",
        "no",
      ],
      { stdio: "ignore" },
    );
    const cmd = (...args: string[]) =>
      JSON.parse(
        execFileSync("redis-cli", ["-s", testSocket, "--json", ...args], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      );
    try {
      for (let i = 0; i < 100; i++) {
        try {
          if (cmd("PING") === "PONG") break;
        } catch {}
        await delay(10);
      }
      const reset = Date.now() + 86400_000;
      const provision = (key: string, contract = "fresh-window") =>
        cmd("EVAL", PROVISION_ALLOWANCE, "1", key, contract);
      expect(provision("release-allocation")).toBe(1);
      expect(cmd("TTL", "release-allocation")).toBe(-1);
      cmd("HSET", "release-allocation", "used", "37");
      expect(provision("release-allocation", "changed-window")).toBe(0);
      expect(cmd("HGET", "release-allocation", "used")).toBe("37");
      expect(cmd("HGET", "release-allocation", "contract")).toBe(
        "fresh-window",
      );
      cmd("HSET", "partial-allocation", "used", "90");
      expect(provision("partial-allocation")).toBe(0);
      expect(cmd("HGET", "partial-allocation", "contract")).toBe(null);
      const reserve = (ceiling: number, contract = "confirmed-window") =>
        cmd(
          "EVAL",
          RESERVE_CREDENTIAL_ATTEMPT,
          "1",
          "shared-credential",
          String(Date.now()),
          String(reset),
          contract,
          "4998",
          String(ceiling),
        );
      expect(reserve(5000)).toBe(-4);
      cmd(
        "HSET",
        "shared-credential",
        "contract",
        "confirmed-window",
        "used",
        "4998",
      );
      cmd("PEXPIRE", "shared-credential", "60000");
      expect(
        await Promise.all([
          Promise.resolve().then(() => reserve(5000)),
          Promise.resolve().then(() => reserve(5000)),
          Promise.resolve().then(() => reserve(5000)),
        ]),
      ).toEqual([4999, 5000, -1]);
      expect(cmd("PTTL", "shared-credential")).toBe(-1);
      expect(reserve(10000)).toBe(5001);
      expect(reserve(10000, "changed-prior-usage")).toBe(-2);
      cmd("DEL", "shared-credential");
      expect(reserve(10000)).toBe(-4);
    } finally {
      try {
        cmd("SHUTDOWN", "NOSAVE");
      } catch {}
      server.kill();
      rmSync(testSocket, { force: true });
    }
  });
});
