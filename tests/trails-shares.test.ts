import { describe, expect, it, beforeEach, vi } from "vitest";
import { setup, generate, key } from "./helpers";
import {
  hash,
  signedSession,
  verifySession,
  randomId,
  decryptToken,
} from "../src/lib/core/crypto";
import { visibleDoors } from "../src/lib/core/types";
import { RETENTION } from "../src/lib/core/store";
beforeEach(() => {
  vi.stubEnv("QLOO_MODE", "fixture");
});
describe("server-owned trail mutations", () => {
  it("rejects invented, rank-only, stale and other-owner follow without advancing", async () => {
    const c = await setup(),
      trail = await generate(c),
      first = visibleDoors(trail)[0];
    await expect(
      c.service.action(c.owner, c.ip, trail.id, trail.version, key(), {
        action: "follow",
        entityId: "invented",
        generationId: trail.current!.id,
      }),
    ).rejects.toMatchObject({ code: "input" });
    await expect(
      c.service.action(c.owner, c.ip, trail.id, trail.version - 1, key(), {
        action: "follow",
        entityId: first.id,
        generationId: trail.current!.id,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      c.service.action("another-owner", c.ip, trail.id, trail.version, key(), {
        action: "follow",
        entityId: first.id,
        generationId: trail.current!.id,
      }),
    ).rejects.toMatchObject({ code: "owner" });
    await c.storage.transact((db) => {
      db.trails[trail.id].current!.discovery.results = [];
    });
    await expect(
      c.service.action(c.owner, c.ip, trail.id, trail.version, key(), {
        action: "follow",
        entityId: first.id,
        generationId: trail.current!.id,
      }),
    ).rejects.toMatchObject({ code: "contract" });
    expect((await c.service.read(c.owner, trail.id)).steps).toHaveLength(0);
  });
  it("atomically deduplicates follow and distinguishes save, follow, love, known and reject", async () => {
    const c = await setup();
    let trail = await generate(c);
    const [first, second] = visibleDoors(trail),
      loveIds = trail.loves.map((e) => e.id);
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "save", entityId: first.id },
    );
    expect(trail.loves.map((e) => e.id)).toEqual(loveIds);
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "known", entityId: second.id, generationId: trail.current!.id },
    );
    expect(visibleDoors(trail).map((e) => e.id)).not.toContain(second.id);
    expect(trail.excluded[0].reason).toBe("known");
    const duplicate = key(),
      version = trail.version,
      generationId = trail.current!.id;
    const all = await Promise.all(
      Array.from({ length: 6 }, () =>
        c.service.action(c.owner, c.ip, trail.id, version, duplicate, {
          action: "follow",
          entityId: first.id,
          generationId,
        }),
      ),
    );
    expect(all.every((t) => t.steps.length === 1)).toBe(true);
    trail = all[0];
    expect(trail.loves.map((e) => e.id)).toEqual(loveIds);
    expect(trail.saved[0].id).toBe(first.id);
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "love", entityId: first.id },
    );
    expect(trail.loves).toHaveLength(2);
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "finish" },
    );
    expect(trail.status).toBe("complete");
  });
  it("branches preserve counters/history, undo restores path, and a fourth stop is impossible", async () => {
    const c = await setup();
    let trail = c.trail;
    for (let i = 0; i < 3; i++) {
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
    expect(trail.status).toBe("complete");
    await expect(generate(c, trail)).rejects.toMatchObject({ code: "input" });
    const original = trail.steps.map((s) => s.entity.id),
      count = trail.counters.runs;
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "branch", branchPoint: 1 },
    );
    expect(trail.steps).toHaveLength(1);
    expect(trail.current).toBeUndefined();
    expect(
      await c.storage.transact((db) => db.trails[trail.id].history.length),
    ).toBeGreaterThan(0);
    expect(trail).not.toHaveProperty("history");
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "undo" },
    );
    expect(trail.steps.map((s) => s.entity.id)).toEqual(original);
    expect(trail.counters.runs).toBe(count);
  });
});
describe("unlisted capabilities and immutable snapshots", () => {
  it("uses signed cookies, 192-bit read tokens, authenticated encryption and tamper rejection", () => {
    const id = randomId();
    expect(Buffer.from(id, "base64url")).toHaveLength(24);
    expect(verifySession(signedSession(id))).toBe(hash(id));
    expect(verifySession(`${signedSession(id)}x`)).toBeUndefined();
  });
  it("reuses active exact-version links, redacts private fields, forks independently and revokes immediately", async () => {
    const c = await setup();
    let trail = await generate(c);
    const [first, other] = visibleDoors(trail);
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "save", entityId: other.id },
    );
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "follow", entityId: first.id, generationId: trail.current!.id },
    );
    const share = await c.service.share(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
    );
    expect(
      (await c.service.share(c.owner, c.ip, trail.id, trail.version, key()))
        .token,
    ).toBe(share.token);
    const persisted = await c.storage.transact(
      (db) => db.shares[share.shareId],
    );
    expect(JSON.stringify(persisted)).not.toContain(share.token);
    expect(decryptToken(persisted.ciphertext, persisted.id)).toBe(share.token);
    expect(() => decryptToken(persisted.ciphertext, "wrong-id")).toThrow();
    const snapshot = await c.service.visitor(
      share.token,
      "reader",
      "reader-ip",
    );
    expect(snapshot.steps[0].generation.pool).toHaveLength(1);
    expect(snapshot.steps[0].generation.ranking).toBeUndefined();
    expect(snapshot).not.toHaveProperty("saved");
    expect(snapshot).not.toHaveProperty("loves");
    expect(snapshot).not.toHaveProperty("owner");
    await expect(c.service.read("reader", trail.id)).rejects.toMatchObject({
      code: "owner",
    });
    await c.service.session("reader", "reader-ip");
    const fork = await c.service.fork(
      "reader",
      "reader-ip",
      share.token,
      1,
      key(),
      false,
    );
    expect(fork.steps).toHaveLength(1);
    expect(fork.loves).toEqual([]);
    expect(fork.saved).toEqual([]);
    expect(fork.excluded).toEqual([]);
    expect(fork.current).toBeUndefined();
    await expect(
      c.service.revoke("reader", share.shareId),
    ).rejects.toMatchObject({ code: "owner" });
    trail = await c.service.action(
      c.owner,
      c.ip,
      trail.id,
      trail.version,
      key(),
      { action: "branch", branchPoint: 0 },
    );
    expect(
      (await c.service.visitor(share.token, "reader", "reader-ip")).steps,
    ).toHaveLength(1);
    await c.service.revoke(c.owner, share.shareId);
    await expect(
      c.service.visitor(share.token, "reader", "reader-ip"),
    ).rejects.toMatchObject({ code: "missing" });
    expect((await c.service.read("reader", fork.id)).steps).toHaveLength(1);
  });
  it("deletion removes owner evidence and shares without breaking independent forks; expiry never renews", async () => {
    const c = await setup();
    let trail = await generate(c);
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
    await c.service.session("reader", "reader-ip");
    const fork = await c.service.fork(
      "reader",
      "reader-ip",
      share.token,
      0,
      key(),
      false,
    );
    await c.service.remove(c.owner, trail.id, trail.version);
    await expect(
      c.service.visitor(share.token, "reader", "reader-ip"),
    ).rejects.toMatchObject({ code: "missing" });
    expect((await c.service.read("reader", fork.id)).root.id).toBe(
      trail.root.id,
    );
    c.service.now = () => Date.now() + RETENTION + 1000;
    await expect(c.service.read("reader", fork.id)).rejects.toMatchObject({
      code: "owner",
    });
  });
});

it("acknowledges a repeated owner deletion while keeping a stranger unauthorized", async () => {
  const c = await setup();
  await c.service.remove(c.owner, c.trail.id, c.trail.version);
  expect(await c.service.remove(c.owner, c.trail.id, c.trail.version)).toEqual({
    deleted: true,
  });
  await expect(
    c.service.remove("stranger", c.trail.id, c.trail.version),
  ).rejects.toMatchObject({ code: "owner" });
});
