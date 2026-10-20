import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { migrateDatabase, PostgresRecords } from "../src/lib/core/postgres";
import { RecordStore } from "../src/lib/core/store";
import { TrailService } from "../src/lib/core/service";
import { RunService } from "../src/lib/core/runs";
import { samples } from "../src/lib/core/fixtures";
import { generate, key } from "./helpers";
import { visibleDoors } from "../src/lib/core/types";

const available = ["initdb", "pg_ctl"].every(
  (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0,
);
const directory = resolve(`.cache/pg-test-${process.pid}`);
let sql: Sql;
let started = false;
let port: number;

describe.skipIf(!available)("Postgres durable state", () => {
  beforeAll(async () => {
    mkdirSync(directory, { recursive: true });
    execFileSync(
      "initdb",
      [
        "-D",
        `${directory}/data`,
        "-A",
        "trust",
        "-U",
        "rabbit_test",
        "--no-locale",
      ],
      { stdio: "ignore" },
    );
    const { createServer } = await import("node:net");
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    // An isolated loopback database; no existing database is used.
    execFileSync(
      "pg_ctl",
      [
        "-D",
        `${directory}/data`,
        "-l",
        `${directory}/postgres.log`,
        "-o",
        `-k '' -p ${port} -h 127.0.0.1`,
        "-w",
        "start",
      ],
      { stdio: "ignore" },
    );
    started = true;
    sql = postgres({
      host: "127.0.0.1",
      port,
      database: "postgres",
      username: "rabbit_test",
      prepare: false,
      max: 5,
      onnotice: () => {},
    });
    await migrateDatabase(sql);
    await migrateDatabase(sql);
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
    if (started)
      execFileSync(
        "pg_ctl",
        ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"],
        { stdio: "ignore" },
      );
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps an immutable shared trail across connections, forks it and prunes expired records", async () => {
    const storage = new RecordStore(new PostgresRecords(sql), "durable");
    const service = new TrailService(storage);
    const owner = key(),
      ip = key();
    await service.session(owner, ip);
    let trail = await service.create(owner, ip, samples[0].id, key(), true);
    trail = await generate(
      {
        storage,
        service,
        runs: new RunService(storage),
        owner,
        ip,
        trail,
      },
      trail,
    );
    trail = await service.action(owner, ip, trail.id, trail.version, key(), {
      action: "follow",
      entityId: visibleDoors(trail)[0].id,
      generationId: trail.current!.id,
    });
    trail = await service.action(owner, ip, trail.id, trail.version, key(), {
      action: "finish",
    });
    const share = await service.share(
      owner,
      ip,
      trail.id,
      trail.version,
      key(),
    );
    const reopened = postgres({
      host: "127.0.0.1",
      port,
      database: "postgres",
      username: "rabbit_test",
      prepare: false,
      max: 2,
    });
    try {
      const second = new TrailService(
        new RecordStore(new PostgresRecords(reopened), "durable"),
      );
      expect((await second.read(owner, trail.id)).steps).toHaveLength(1);
      const visitor = key();
      await second.session(visitor, ip);
      expect(
        (await second.visitor(share.token, visitor, ip)).steps,
      ).toHaveLength(1);
      const fork = await second.fork(visitor, ip, share.token, 0, key(), false);
      expect(fork.id).not.toBe(trail.id);
      expect(fork.steps).toHaveLength(0);
      await storage.transact((db) => {
        db.trails[trail.id].expiresAt = Date.now() - 1;
      });
      await storage.transact(() => {});
      expect(
        await new PostgresRecords(sql).get(`durable:trails:${trail.id}`),
      ).toBeNull();
    } finally {
      await reopened.end();
    }
  });

  it("serializes concurrent reservations and rejects stale writes without partial records", async () => {
    const records = new PostgresRecords(sql);
    const a = new RecordStore(records, "races");
    const b = new RecordStore(new PostgresRecords(sql), "races");
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? a : b).transact((db) => {
          db.budgets.cumulative += 20_000;
        }),
      ),
    );
    expect(await a.transact((db) => db.budgets.cumulative)).toBe(160_000);
    expect(
      await records.commit(
        "races",
        0,
        [{ key: "stale", body: "{}" }],
        '{"revision":1}',
      ),
    ).toBe(false);
    expect(await records.get("stale")).toBeNull();
    // An invalid SQL write must roll the earlier body write back too.
    await expect(
      records.commit(
        "rollback",
        0,
        [
          { key: "partial", body: "{}" },
          { key: null as unknown as string, body: "{}" },
        ],
        '{"revision":1}',
      ),
    ).rejects.toBeDefined();
    expect(await records.get("partial")).toBeNull();
    expect(await records.get("rollback")).toBeNull();
  });
});
