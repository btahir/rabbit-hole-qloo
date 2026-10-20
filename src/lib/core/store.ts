import "server-only";
import { kv, type SetOptions } from "@shiptiffin/sdk/kv";
import { databaseClient, PostgresRecords } from "./postgres";
export interface RedisPort {
  get<T = unknown>(key: string): Promise<T | null>;
  mget<T extends unknown[]>(...keys: string[]): Promise<T>;
  set(key: string, value: unknown, options?: SetOptions): Promise<unknown>;
  del(key: string): Promise<unknown>;
  key?(key: string): string;
  eval(
    script: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<unknown>;
}
import { AppError } from "./errors";
import { encodeRecord, decodeRecord } from "./record-codec";
import { applyLimits, limitRules, type LimitKind } from "./limits";
import type { Database } from "./types";
export const RETENTION = 30 * 24 * 60 * 60 * 1000;
export function emptyDatabase(): Database {
  return {
    schema: 1,
    revision: 0,
    sessions: {},
    trails: {},
    shares: {},
    runs: {},
    windows: {},
    budgets: { cumulative: 0, daily: {} },
    qloo: {},
    qlooLeases: {},
    circuitUntil: 0,
    votes: {},
    forks: {},
    deletions: {},
  };
}
export interface AtomicStore {
  transact<T>(fn: (db: Database) => T, now?: number): Promise<T>;
  admit?(
    owner: string,
    ip: string,
    kind: LimitKind,
    now: number,
  ): Promise<void>;
}
export async function admit(
  storage: AtomicStore,
  owner: string,
  ip: string,
  kind: LimitKind,
  now = Date.now(),
) {
  if (storage.admit) return storage.admit(owner, ip, kind, now);
  await storage.transact((db) => applyLimits(db, owner, ip, kind, now), now);
}
export function prune(db: Database, now: number) {
  for (const map of [
    db.sessions,
    db.trails,
    db.shares,
    db.runs,
    db.votes,
    db.deletions,
  ])
    for (const [id, item] of Object.entries(map))
      if (item.expiresAt <= now) delete map[id];
  for (const [key, trailId] of Object.entries(db.forks))
    if (!db.trails[trailId]) delete db.forks[key];
  const oldestDay = new Date(now - RETENTION).toISOString().slice(0, 10);
  for (const buckets of [db.qloo, db.budgets.daily])
    for (const date of Object.keys(buckets))
      if (date < oldestDay) delete buckets[date];
  for (const [key, values] of Object.entries(db.windows)) {
    db.windows[key] = values.filter((t) => t > now - 86_400_000);
    if (!db.windows[key].length) delete db.windows[key];
  }
  for (const run of Object.values(db.runs))
    if (["running", "reserved"].includes(run.state) && run.leaseUntil <= now) {
      run.state = "expired";
      run.error = "interrupted";
      run.events.push({
        sequence: run.events.length + 1,
        runId: run.id,
        type: "error",
        message: "This step was interrupted. Your saved trail is safe.",
        at: now,
      });
      const trail = db.trails[run.trailId];
      if (trail?.activeRun === run.id) delete trail.activeRun;
    }
  for (const [id, expiry] of Object.entries(db.qlooLeases))
    if (expiry <= now) delete db.qlooLeases[id];
}
export class MemoryStore implements AtomicStore {
  private db = emptyDatabase();
  async transact<T>(fn: (db: Database) => T, now = Date.now()): Promise<T> {
    const next = structuredClone(this.db);
    prune(next, now);
    const result = fn(next);
    next.revision++;
    this.db = next;
    return structuredClone(result);
  }
}
// The revision contains only compact indexes/quotas. Record bodies are hydrated
// lazily when a transaction actually needs them; only changed bodies are written.
// A synchronous transaction can be retried, so it must have no external effects.
const RECORD_TABLES = [
  "sessions",
  "trails",
  "shares",
  "runs",
  "votes",
  "deletions",
] as const;
type Table = (typeof RECORD_TABLES)[number];
class NeedRecord {
  constructor(
    public table: Table,
    public id: string,
  ) {}
}
const CAS = `
local raw = redis.call('GET', KEYS[1])
local old = raw and cjson.decode(raw) or {revision=0}
if old.revision ~= tonumber(ARGV[1]) then return 0 end
local writes = cjson.decode(ARGV[2])
for _,item in ipairs(writes) do
  if item.body then
    redis.call('SET', item.key, item.body)
  else redis.call('DEL', item.key) end
end
redis.call('SET', KEYS[1], ARGV[3])
return 1`;
function summary(item: Record<string, unknown>) {
  const result: Record<string, unknown> = {
    stored: true,
    expiresAt: item.expiresAt,
  };
  // Enough for ownership, token lookup, idempotency and active-lease selection.
  // Never put names, preferences, snapshots, evidence or capability ciphertext here.
  for (const key of [
    "owner",
    "trailId",
    "tokenHash",
    "revoked",
    "version",
    "key",
    "state",
    "leaseUntil",
  ])
    if (key in item) result[key] = item[key];
  return result;
}
// Independent bounded windows: one atomic operation, no product revision writes.
const ADMISSION = `
local now = tonumber(ARGV[1])
local rules = cjson.decode(ARGV[2])
local all = {}
for i,rule in ipairs(rules) do
  local raw = redis.call('GET', KEYS[i])
  local values = raw and cjson.decode(raw) or {}
  local kept = {}
  for _,t in ipairs(values) do if t >= rule.cutoff and t <= now then table.insert(kept, t) end end
  if #kept >= rule.max then return rule.retryDaily or (kept[1] + rule.windowMs + 1) end
  table.insert(kept, now)
  all[i] = kept
end
for i,rule in ipairs(rules) do redis.call('SET', KEYS[i], cjson.encode(all[i]), 'PXAT', rule.expiry) end
return 0`;
export interface RecordWrite {
  key: string;
  body?: string;
}
export interface RecordBackend {
  get<T = unknown>(key: string): Promise<T | null>;
  commit(
    key: string,
    revision: number,
    writes: RecordWrite[],
    metadata: string,
  ): Promise<boolean>;
}
// Shared lazy hydration and optimistic concurrency for both durable backends.
export class RecordStore implements AtomicStore {
  constructor(
    private records: RecordBackend,
    private key = "rabbit-hole:core:v2",
  ) {}
  async transact<T>(fn: (db: Database) => T, now = Date.now()): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      let metadata: Database;
      try {
        metadata =
          (await this.records.get<Database>(this.key)) ?? emptyDatabase();
      } catch {
        throw new AppError("storage", 503);
      }
      const loaded = new Map<string, unknown>();
      const originals = new Map<string, string>();
      let db!: Database, result!: T;
      // At most one hydration per existing record, independent of database size.
      while (true) {
        db = structuredClone(metadata);
        for (const table of RECORD_TABLES) {
          const values = db[table] as unknown as Record<string, unknown>;
          for (const [id, index] of Object.entries(values)) {
            const key = `${table}:${id}`;
            if (loaded.has(key)) {
              const item = loaded.get(key);
              if (item === null) delete values[id];
              else values[id] = structuredClone(item);
            } else if ((index as { stored?: boolean }).stored) {
              const requireBody = () => {
                throw new NeedRecord(table, id);
              };
              values[id] = new Proxy(index as object, {
                get(target, property) {
                  if (typeof property === "symbol")
                    return Reflect.get(target, property);
                  if (Object.hasOwn(target, property))
                    return Reflect.get(target, property);
                  return requireBody();
                },
                ownKeys: requireBody,
                set: requireBody,
                deleteProperty: requireBody,
              });
            } else {
              loaded.set(key, index);
              originals.set(key, encodeRecord(index));
            }
          }
        }
        try {
          prune(db, now);
          // Materialize any lazy record returned by the callback before committing.
          const value = fn(db);
          result =
            value === undefined
              ? (value as T)
              : (JSON.parse(JSON.stringify(value)) as T);
          break;
        } catch (error) {
          if (!(error instanceof NeedRecord)) throw error;
          const key = `${error.table}:${error.id}`;
          try {
            const raw = await this.records.get<unknown>(`${this.key}:${key}`);
            const item = decodeRecord(raw);
            loaded.set(key, item);
            if (item !== null) originals.set(key, encodeRecord(item));
          } catch {
            throw new AppError("storage", 503);
          }
        }
      }
      const writes: { key: string; body?: string; expiresAt?: number }[] = [];
      const next = { ...db, revision: metadata.revision + 1 };
      for (const table of RECORD_TABLES) {
        const index: Record<string, unknown> = {};
        for (const [id, item] of Object.entries(db[table])) {
          const key = `${table}:${id}`;
          if (!loaded.has(key) && Object.hasOwn(metadata[table], id)) {
            index[id] = (metadata[table] as unknown as Record<string, unknown>)[
              id
            ];
            continue;
          }
          const body = encodeRecord(item);
          if (Buffer.byteLength(body) > 512 * 1024)
            throw new AppError("storage", 503);
          if (originals.get(key) !== body)
            writes.push({
              key: `${this.key}:${key}`,
              body,
              expiresAt: item.expiresAt,
            });
          index[id] = summary(item as unknown as Record<string, unknown>);
        }
        for (const id of Object.keys(metadata[table]))
          if (!Object.hasOwn(db[table], id))
            writes.push({ key: `${this.key}:${table}:${id}` });
        (next as unknown as Record<string, unknown>)[table] = index;
      }
      // Bound only indexes/operating state; retained cultural payloads have their
      // own per-record limits and expiry and never share a 2 MiB payload ceiling.
      // Unchanged reads need no CAS, even while unrelated writers are active.
      if (
        !writes.length &&
        JSON.stringify({ ...next, revision: metadata.revision }) ===
          JSON.stringify(metadata)
      )
        return result;
      const encoded = JSON.stringify(next);
      if (Buffer.byteLength(encoded) > 4 * 1024 * 1024)
        throw new AppError("storage", 503);
      try {
        if (
          await this.records.commit(
            this.key,
            metadata.revision,
            writes,
            encoded,
          )
        )
          return result;
      } catch {
        throw new AppError("storage", 503);
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(40, 2 ** Math.min(attempt, 5)) + Math.random() * 8,
        ),
      );
    }
    throw new AppError("conflict", 409);
  }
}
export class RedisStore extends RecordStore {
  constructor(
    private redis: RedisPort,
    private redisKey = "rabbit-hole:core:v2",
  ) {
    super(
      {
        get: (key) => redis.get(key),
        commit: async (key, revision, writes, metadata) =>
          (await redis.eval(
            CAS,
            [key],
            [
              revision,
              JSON.stringify(
                writes.map((write) => ({
                  ...write,
                  key: redis.key?.(write.key) ?? write.key,
                })),
              ),
              metadata,
            ],
          )) === 1,
      },
      redisKey,
    );
  }
  async admit(owner: string, ip: string, kind: LimitKind, now: number) {
    const rules = limitRules(owner, ip, kind).map((rule) => ({
      ...rule,
      cutoff:
        rule.windowMs === 86_400_000
          ? Date.parse(new Date(now).toISOString().slice(0, 10))
          : now - rule.windowMs,
      retryDaily:
        rule.windowMs === 86_400_000
          ? Date.parse(new Date(now).toISOString().slice(0, 10)) + rule.windowMs
          : undefined,
      expiry: now + rule.windowMs + 1000,
    }));
    let retryAt: number;
    try {
      retryAt = Number(
        await this.redis.eval(
          ADMISSION,
          rules.map((r) => `${this.redisKey}:limit:${r.key}`),
          [now, JSON.stringify(rules)],
        ),
      );
    } catch {
      throw new AppError("storage", 503);
    }
    if (!Number.isSafeInteger(retryAt) || retryAt < 0)
      throw new AppError("storage", 503);
    if (retryAt > 0) throw new AppError("limit", 429, retryAt);
  }
}
const globalStore = globalThis as typeof globalThis & {
  rabbitStore?: AtomicStore;
};
export function redisClient(): RedisPort | undefined {
  if (!process.env.REDIS_URL) return;
  const client = kv();
  return {
    get: (key) => client.get(key),
    mget: <T extends unknown[]>(...keys: string[]) =>
      client.mget(...keys) as Promise<T>,
    set: (key, value, options) => client.set(key, value, options),
    del: (key) => client.del(key),
    key: (key) => client.key(key),
    eval: (script, keys, args) =>
      client.command(
        "EVAL",
        script,
        keys.length,
        ...keys.map((key) => client.key(key)),
        ...args,
      ),
  };
}
export function store(): AtomicStore {
  if (globalStore.rabbitStore) return globalStore.rabbitStore;
  const database = databaseClient();
  if (database)
    return (globalStore.rabbitStore = new RecordStore(
      new PostgresRecords(database),
      `rabbit-hole:${process.env.ENTITLEMENT_NAMESPACE || "default"}:core:v2`,
    ));
  const redis = redisClient();
  if (redis)
    return (globalStore.rabbitStore = new RedisStore(
      redis,
      `rabbit-hole:${process.env.ENTITLEMENT_NAMESPACE || "default"}:core:v2`,
    ));
  if (
    process.env.NODE_ENV !== "production" ||
    (process.env.ALLOW_MEMORY_STORE === "1" &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
        process.env.APP_ORIGIN ?? "",
      ))
  )
    return (globalStore.rabbitStore = new MemoryStore());
  throw new AppError("storage", 503);
}
