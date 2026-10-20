import { it, expect, vi, afterEach } from "vitest";
import { setup, generate, key } from "./helpers";
import { qlooPort } from "../src/lib/core/qloo";
import { MemoryStore, prune } from "../src/lib/core/store";
import { publicGeneration } from "../src/lib/core/service";
import { agentInput, RunService } from "../src/lib/core/runs";
import { AppError } from "../src/lib/core/errors";
import { encodeRecord, decodeRecord } from "../src/lib/core/record-codec";
afterEach(() => vi.unstubAllEnvs());
const anchor = {
  id: "10000000-0000-4000-8000-000000000001",
  medium: "movie" as const,
  name: "Confirmed film",
  source: "Qloo" as const,
  checkedAt: "2026-10-17T00:00:00.000Z",
  schemaVersion: 1 as const,
};
const artist = {
  entity_id: "20000000-0000-4000-8000-000000000001",
  name: "Confirmed artist",
  type: "urn:entity:artist",
  query: { affinity: 0, explainability: { [anchor.id]: 0.4 } },
};
function live(
  storage = new MemoryStore(),
  fetcher: typeof fetch = vi.fn(async () =>
    Response.json({
      results: { entities: [{ name: "Missing identity" }, artist] },
      query: { explainability: { warning: "unavailable" } },
    }),
  ),
) {
  vi.stubEnv("QLOO_API_KEY", "synthetic-test-only");
  vi.stubEnv("QLOO_DAILY_ATTEMPTS", "500");
  return {
    storage,
    fetcher,
    port: qlooPort({ storage, owner: key(), mode: "live", fetch: fetcher }),
  };
}
it("normalizes mixed rows before decoding and cache writes, keeps original positions, zero scores and explanation status", async () => {
  const { port, fetcher } = live();
  const input = {
    anchor,
    medium: "artist" as const,
    exclusions: [],
    lessObvious: false,
  };
  const first = await port.insights(input),
    second = await port.insights(input);
  expect(first.entities).toHaveLength(1);
  expect(first.evidence.results[0]).toMatchObject({
    position: 2,
    affinity: 0,
    explanation: {
      status: "returned",
      contributions: [{ entityId: anchor.id, value: 0.4 }],
    },
  });
  expect(first.evidence.warnings).toContain(
    "1 results could be used; some details were missing.",
  );
  expect(first.evidence.warnings).toContain(
    "Qloo could not compute some explanation data.",
  );
  expect(second.evidence.cache).toBe("hit");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const malformed = live(
    new MemoryStore(),
    vi.fn(async () =>
      Response.json({ results: { entities: [{ name: "No identity" }] } }),
    ),
  );
  await expect(malformed.port.insights(input)).rejects.toMatchObject({
    code: "contract",
  });
});
it("coalesces identical same-owner requests across product ports without crossing private scopes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetcher = vi.fn(async () => {
    await gate;
    return Response.json({ results: [artist] });
  });
  const { storage } = live(new MemoryStore(), fetcher);
  const options = {
    storage,
    owner: key(),
    mode: "live" as const,
    fetch: fetcher,
  };
  const a = qlooPort(options).resolveStart("Same explicit search", "artist");
  const b = qlooPort(options).resolveStart("Same explicit search", "artist");
  release();
  await Promise.all([a, b]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await qlooPort({ ...options, owner: key() }).resolveStart(
    "Same explicit search",
    "artist",
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("the emergency pause prevents search, hydration and the next attempt of an existing run", async () => {
  const { port, fetcher } = live();
  vi.stubEnv("INFERENCE_PAUSED", "1");
  await expect(
    port.resolveStart("A new search", "artist"),
  ).rejects.toMatchObject({ code: "paused" });
  await expect(
    port.describeEntities([artist.entity_id], "artist"),
  ).rejects.toMatchObject({ code: "paused" });
  await expect(
    port.insights({
      anchor,
      medium: "artist",
      exclusions: [],
      lessObvious: false,
    }),
  ).rejects.toMatchObject({ code: "paused" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("a pre-acceptance cancellation tombstone rejects the same generation request without a run", async () => {
  const c = await setup(),
    input = agentInput.parse({
      trailId: c.trail.id,
      expectedVersion: 1,
      intent: "generate",
      idempotencyKey: key(),
    });
  await c.runs.cancelPending(c.owner, c.trail.id, input.idempotencyKey);
  await expect(c.runs.begin(c.owner, c.ip, input)).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(await c.storage.transact((db) => Object.keys(db.runs))).toHaveLength(
    0,
  );
});
it("an encrypted preview receipt saves on another worker, rejects tampering, cancellation and expiry, and never regenerates", async () => {
  const c = await setup();
  let fail = true;
  const storage = {
    transact: <T>(
      fn: (db: import("../src/lib/core/types").Database) => T,
      now?: number,
    ) =>
      c.storage.transact((db) => {
        const result = fn(db);
        if (fail && Object.values(db.runs).some((r) => r.state === "committed"))
          throw new AppError("storage", 503);
        return result;
      }, now),
  };
  const source = new RunService(storage),
    input = agentInput.parse({
      trailId: c.trail.id,
      expectedVersion: 1,
      intent: "generate",
      idempotencyKey: key(),
    });
  const accepted = await source.begin(c.owner, c.ip, input);
  let receipt = "";
  await source.execute(
    c.owner,
    accepted.run.id,
    input,
    accepted.trail,
    (_event, _preview, value) => {
      if (value) receipt = value;
    },
  );
  expect(receipt.length).toBeGreaterThan(100);
  fail = false;
  vi.resetModules();
  const { RunService: OtherWorker } = await import("../src/lib/core/runs");
  const worker = new OtherWorker(c.storage);
  await expect(
    worker.saveResult(c.owner, accepted.run.id, receipt + "x"),
  ).rejects.toMatchObject({ code: "unsaved" });
  await expect(
    new RunService(c.storage, () => Date.now() + 21 * 60_000).saveResult(
      c.owner,
      accepted.run.id,
      receipt,
    ),
  ).rejects.toMatchObject({ code: "unsaved" });
  const saved = await worker.saveResult(c.owner, accepted.run.id, receipt);
  expect(saved.current?.pool).toHaveLength(12);
  expect(saved.counters.runs).toBe(1);
  await c.runs.cancel(c.owner, accepted.run.id);
  await expect(
    worker.saveResult(c.owner, accepted.run.id, receipt),
  ).resolves.toMatchObject({
    version: saved.version,
    counters: saved.counters,
  });
});
it("normalizes repeated generation/evidence in undo and history losslessly and removes orphan fork indexes", async () => {
  const c = await setup();
  const t = await generate(c);
  const raw = await c.storage.transact((db) => db.trails[t.id]);
  raw.undo = { kind: "path", snapshot: JSON.stringify(raw) };
  const encoded = encodeRecord(raw);
  expect(decodeRecord(JSON.parse(encoded))).toEqual(raw);
  expect(encoded.length).toBeLessThan(JSON.stringify(raw).length / 2);
  const pub = publicGeneration(t.current!, t.current!.pool[0]);
  expect(pub.ranking).toBeUndefined();
  expect(pub.discovery.loves).toEqual([]);
  await c.storage.transact((db) => {
    db.forks["owner:key"] = "missing-trail";
    prune(db, Date.now());
    expect(db.forks).toEqual({});
  });
});
