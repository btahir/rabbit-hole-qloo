import "server-only";
import {
  QlooClient,
  QLOO_ORIGIN,
  parseRetryAfter,
  type QlooResult,
} from "../qloo/client";
import { QlooError } from "../qloo/errors";
import { MemoryCache } from "../qloo/cache";
import { DevDiskCache } from "../qloo/dev-cache";
import { publicQuery } from "./public-query";
import { paceQloo } from "./qloo-pacing";
import { reserveCredentialAttempt } from "./qloo-allowance";
import { activatedSamples } from "./activated-samples";
import { eligibleSuggestion } from "./suggestion-policy";
import type { InsightsRequest } from "../qloo/requests";
import { entitySchema, type QlooEntity } from "../qloo/schemas";
import { redisClient, type AtomicStore } from "./store";
import { AppError, assert } from "./errors";
import { hash, randomId } from "./crypto";
import { claimQloo } from "./limits";
import { boundedRedisCache } from "./cache";
import { normalizeEntity } from "./entities";
import { fixturePool, fixtureSearch } from "./fixtures";
import type { Entity, Evidence, Medium, Mode, Trail } from "./types";
export const QLOO_DECODER = "rabbit-qloo-3";
export interface DiscoveryInput {
  anchor: Entity;
  medium: Medium;
  exclusions: string[];
  lessObvious: boolean;
  candidates?: Entity[];
  catalog?: Entity[];
  loves?: Entity[];
}
export interface DiscoveryResult {
  entities: Entity[];
  evidence: Evidence;
}
export interface QlooPort {
  resolveStart(query: string, medium: Medium): Promise<Entity[]>;
  describeEntities(ids: string[], medium: Medium): Promise<Entity[]>;
  insights(input: DiscoveryInput): Promise<DiscoveryResult>;
}
const memoryCache = new MemoryCache(2000, 32 * 1024 * 1024);
function mappedError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof QlooError) {
    if (error.kind === "not_found" && error.status === 400)
      throw new AppError("invalid_seed", 422);
    if (["auth", "permission"].includes(error.kind))
      throw new AppError("configuration", 503);
    if (["contract", "input"].includes(error.kind) || error.status === 200)
      throw new AppError("contract", 502);
    if (error.kind === "rate_limit")
      throw new AppError(
        "limit",
        429,
        Date.now() + Math.max(error.retryAfterMs ?? 60_000, 1000),
      );
    if (error.kind === "timeout") throw new AppError("timeout", 504);
    if (error.kind === "cancelled") throw new AppError("cancelled", 409);
  }
  throw new AppError("qloo", 502);
}
export function qlooPort(options: {
  storage: AtomicStore;
  owner: string;
  mode: Mode;
  runId?: string;
  trailId?: string;
  signal?: AbortSignal;
  onEvent?: (message: string) => Promise<void>;
  fetch?: typeof fetch;
}): QlooPort {
  const { storage, owner, mode, runId, trailId, signal, onEvent } = options;
  let client: QlooClient | undefined;
  let publicClient: QlooClient | undefined;
  let policyError: AppError | undefined;
  const rethrow = (error: unknown): never => {
    if (policyError) throw policyError;
    return mappedError(error);
  };
  if (mode === "live") {
    assert(process.env.QLOO_API_KEY, "configuration", 503);
    const redis = redisClient();
    const devDirectory = process.env.QLOO_DEV_CACHE_DIR;
    // Never enable a cross-session development cache on a public production host.
    const localCheck =
      process.env.ALLOW_MEMORY_STORE === "1" &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(
        process.env.APP_ORIGIN ?? "",
      );
    const devCache =
      devDirectory &&
      !options.fetch &&
      (process.env.NODE_ENV !== "production" || localCheck)
        ? new DevDiskCache(devDirectory)
        : undefined;
    const cache = redis
      ? boundedRedisCache(redis, process.env.ENTITLEMENT_NAMESPACE || "default")
      : memoryCache;
    const transport = (shared = false) => ({
      mode: "live" as const,
      fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const lease = randomId(),
          now = Date.now();
        try {
          await storage.transact((db) => {
            const run = runId ? db.runs[runId] : undefined,
              trail = trailId ? db.trails[trailId] : undefined;
            if (runId && !shared)
              assert(
                run && run.state === "running" && run.leaseUntil > now,
                "cancelled",
                409,
              );
            const chargeRun =
              !shared || run?.state === "running" ? run : undefined;
            claimQloo(db, chargeRun ? trail : undefined, chargeRun, lease, now);
          });
        } catch (error) {
          if (error instanceof AppError) policyError = error;
          throw error;
        }
        try {
          await devCache?.reserveAttempt(
            new URL(String(input)).pathname,
            init?.signal,
          );
          if (!options.fetch) await reserveCredentialAttempt();
          if (!options.fetch && !devCache)
            await paceQloo(init?.signal ?? new AbortController().signal);
          init?.signal?.throwIfAborted();
          const response = await (options.fetch ?? fetch)(input, init);
          if ([401, 403, 429].includes(response.status)) {
            const retry = response.headers.get("retry-after");
            const retryMs =
              parseRetryAfter(retry, now) ??
              (response.status === 429 ? 1000 : 60_000);
            await storage.transact((db) => {
              db.circuitUntil =
                now +
                (response.status === 429
                  ? Math.max(1000, Number.isFinite(retryMs) ? retryMs : 60_000)
                  : 60_000);
            });
          }
          // Hold the global semaphore until the bounded body is consumed, not just headers.
          const body = response.body;
          if (!body) {
            await storage.transact((db) => {
              delete db.qlooLeases[lease];
            });
            return response;
          }
          const reader = body.getReader();
          let released = false;
          const release = async () => {
            if (!released) {
              released = true;
              await storage.transact((db) => {
                delete db.qlooLeases[lease];
              });
            }
          };
          return new Response(
            new ReadableStream({
              async pull(controller) {
                try {
                  const chunk = await reader.read();
                  if (chunk.done) {
                    await release();
                    controller.close();
                  } else controller.enqueue(chunk.value);
                } catch (e) {
                  await release();
                  controller.error(e);
                }
              },
              async cancel() {
                await reader.cancel();
                await release();
              },
            }),
            { status: response.status, headers: response.headers },
          );
        } catch (error) {
          if (error instanceof AppError) policyError = error;
          await storage.transact((db) => {
            delete db.qlooLeases[lease];
          });
          throw error;
        }
      },
    });
    const clientOptions: import("../qloo/client").QlooClientOptions = {
      origin: QLOO_ORIGIN,
      apiKey: process.env.QLOO_API_KEY,
      cache,
      devCache,
      coalesceAcrossClients: true,
      cacheNamespace: `rabbit-hole:decoder-3:${process.env.ENTITLEMENT_NAMESPACE || "default"}:session:${owner}`,
      transport: transport(),
      normalizeResponse: (
        observation: import("../qloo/client").ResponseObservation,
      ) => {
        if (observation.responseName === "entityInsights")
          normalizePartialCollection(observation.body);
        return observation.body;
      },
      maxAttempts: runId ? 2 : 1,
      backoffMs: 1000,
      timeoutMs: 8000,
      totalDeadlineMs: 12000,
    };
    client = new QlooClient(clientOptions);
    publicClient = new QlooClient({
      ...clientOptions,
      transport: transport(true),
      coalesceAcrossClients: false,
      cacheNamespace: `rabbit-hole:decoder-3:${process.env.ENTITLEMENT_NAMESPACE || "default"}:public-samples`,
    });
  }
  const requestOptions = { signal, cacheTtlMs: 3_600_000 };
  return {
    async resolveStart(query, medium) {
      if (mode === "fixture") return fixtureSearch(query, medium);
      await onEvent?.(`Checking ${query}…`);
      try {
        const result = await client!.searchEntities(
          { query, types: [`urn:entity:${medium}`], take: 5, sort_by: "match" },
          requestOptions,
        );
        return result.data.results.map((row) =>
          normalizeEntity(row, medium, result.provenance.fetchedAt),
        );
      } catch (e) {
        return rethrow(e);
      }
    },
    async describeEntities(ids, medium) {
      assert(
        ids.length > 0 && ids.length <= 12 && new Set(ids).size === ids.length,
      );
      if (mode === "fixture")
        return fixturePool(
          { name: "", id: "", medium } as Entity,
          medium,
          [],
          false,
        ).filter((e) => ids.includes(e.id));
      try {
        const result = await publicClient!.getEntities(
          { entity_ids: ids },
          requestOptions,
        );
        return result.data.results
          .map((row) =>
            normalizeEntity(row, medium, result.provenance.fetchedAt),
          )
          .filter((e) => ids.includes(e.id));
      } catch (e) {
        return rethrow(e);
      }
    },
    async insights(input) {
      assert(input.exclusions.length <= 96);
      if (input.candidates)
        assert(
          input.candidates.length <= 12 &&
            input.candidates.every((e) => e.medium === input.medium) &&
            input.loves?.length &&
            input.loves.length <= 6,
        );
      const kind = input.candidates ? "ranking" : "discovery";
      let entities: Entity[],
        checkedAt: string,
        source: Evidence["source"],
        cache: Evidence["cache"],
        elapsedMs: number;
      let results: Evidence["results"];
      const warnings: string[] = [];
      if (mode === "live" && input.exclusions.length > 50)
        warnings.push(
          "The full exclusion list was checked locally; 50 exclusions were also sent to Qloo. Coverage may be sparse.",
        );
      if (mode === "fixture") {
        entities = fixturePool(
          input.anchor,
          input.medium,
          input.exclusions,
          input.lessObvious,
        );
        if (input.candidates) entities = input.candidates.slice().reverse();
        checkedAt = "2026-10-17T00:00:00.000Z";
        source = "synthetic";
        cache = "miss";
        elapsedMs = 0;
        results = entities.map((e, i) => ({ id: e.id, position: i + 1 }));
      } else {
        const query: InsightsRequest<`urn:entity:${Medium}`> = {
          "filter.type": `urn:entity:${input.medium}`,
          "signal.interests.entities": input.candidates
            ? input.loves!.map((e) => e.id)
            : [input.anchor.id],
          take: 12,
          sort_by: "affinity",
          "feature.explainability": true,
        };
        if (input.exclusions.length)
          query["filter.exclude.entities"] = input.exclusions.slice(0, 50);
        if (input.lessObvious) query["filter.popularity.max"] = 0.8;
        if (input.medium === "movie")
          query["filter.content_rating"] = ["G", "PG", "PG-13"];
        if (input.candidates || input.catalog)
          query["filter.results.entities"] = (input.candidates ??
            input.catalog)!.map((e) => e.id);
        let result: QlooResult<{
          results: { entities: QlooEntity[] };
          warnings?: unknown;
        }>;
        try {
          const publicSample =
            !input.candidates &&
            !input.catalog &&
            !input.loves?.length &&
            input.exclusions.every((id) => id === input.anchor.id) &&
            (await activatedSamples()).some(
              (entity) => entity.id === input.anchor.id,
            );
          result = publicSample
            ? await publicQuery(
                hash(
                  JSON.stringify([
                    process.env.ENTITLEMENT_NAMESPACE || "default",
                    process.env.QLOO_API_KEY,
                    query,
                  ]),
                ),
                () => publicClient!.insights(query, { cacheTtlMs: 300_000 }),
                redisClient() ?? undefined,
                signal,
                (saved) => ({
                  ...saved,
                  provenance: {
                    ...saved.provenance,
                    cache: "hit",
                    attempts: 0,
                  },
                }),
              )
            : await client!.insights(query, { signal, cacheTtlMs: 300_000 });
        } catch (e) {
          return rethrow(e);
        }
        ({ fetchedAt: checkedAt, cache, elapsedMs } = result.provenance);
        source = "qloo";
        const signals = (input.candidates ? input.loves! : [input.anchor]).map(
          (e) => e.id.toLowerCase(),
        );
        assert(
          !invalidRequiredSignal(result.data.warnings, signals),
          "invalid_seed",
          422,
        );
        const valid: {
          entity: Entity;
          position: number;
          affinity?: number;
          explanation: NonNullable<Evidence["results"][number]["explanation"]>;
        }[] = [];
        let policyFiltered = 0;
        let invalidRows = 0;
        for (const [i, row] of result.data.results.entities.entries()) {
          try {
            const entity = normalizeEntity(row, input.medium, checkedAt);
            if (!eligibleSuggestion(row)) {
              policyFiltered++;
              continue;
            }
            if (
              input.exclusions.includes(entity.id) ||
              valid.some((x) => x.entity.id === entity.id)
            )
              continue;
            if (
              (input.candidates ?? input.catalog) &&
              !(input.candidates ?? input.catalog)!.some(
                (e) => e.id === entity.id,
              )
            )
              continue;
            valid.push({
              entity,
              position:
                typeof row.rabbitOriginalPosition === "number"
                  ? row.rabbitOriginalPosition
                  : i + 1,
              affinity: row.affinity ?? row.query?.affinity ?? undefined,
              explanation: explanationProjection(
                row.query?.explainability,
                input.candidates ? (input.loves ?? []) : [input.anchor],
              ),
            });
          } catch {
            invalidRows++;
            warnings.push(
              "Some details are missing. These doors have checked names and connections.",
            );
          }
        }
        if (
          result.data.results.entities.length &&
          invalidRows === result.data.results.entities.length
        )
          throw new AppError("contract", 502);
        if ((result.data as Record<string, unknown>).rabbitInvalidCount)
          warnings.push(
            `${entitiesCount(result.data)} results could be used; some details were missing.`,
          );
        if (result.data.warnings)
          warnings.push("Qloo returned a response warning.");
        if (policyFiltered)
          warnings.push(
            `${policyFiltered} ${policyFiltered === 1 ? "suggestion was" : "suggestions were"} left out by the content and continuation checks.`,
          );
        const responseQuery = (result.data as Record<string, unknown>).query as
          { explainability?: { warning?: unknown } } | undefined;
        if (responseQuery?.explainability?.warning)
          warnings.push("Qloo could not compute some explanation data.");
        entities = valid.map((x) => x.entity).slice(0, 12);
        results = valid.map((x) => ({
          id: x.entity.id,
          position: x.position,
          explanation: x.explanation,
          ...(x.affinity === undefined ? {} : { affinity: x.affinity }),
        }));
      }
      const evidence: Evidence = {
        id: randomId(),
        runId: runId ?? "search",
        kind,
        anchor: input.anchor,
        endpoint: "/v2/insights",
        medium: input.medium,
        results,
        exclusionsCount: input.exclusions.length,
        upstreamExclusionsCount:
          mode === "live" ? Math.min(50, input.exclusions.length) : 0,
        localExclusionsCount: input.exclusions.length,
        exclusionsHash: hash(input.exclusions.join(",")),
        ...(input.lessObvious ? { popularityMax: 0.8 } : {}),
        loves: input.candidates ? (input.loves ?? []) : [],
        source,
        cache,
        checkedAt,
        elapsedMs,
        warnings: [...new Set(warnings)],
        decoder: QLOO_DECODER,
      };
      return { entities, evidence };
    },
  };
}
export function exclusionsFor(trail: Trail) {
  return [
    ...new Set([
      trail.root.id,
      ...trail.steps.map((s) => s.entity.id),
      ...trail.excluded.map((x) => x.entity.id),
      ...trail.shown,
    ]),
  ].slice(0, 96);
}

function entitiesCount(data: { results: { entities: unknown[] } }) {
  return data.results.entities.length;
}
/** Called only on fresh transport data. Original positions survive private cache. */
export function normalizePartialCollection(body: unknown) {
  if (!body || typeof body !== "object" || !("results" in body)) return;
  const data = body as {
    results?: { entities?: unknown[] };
    rabbitInvalidCount?: number;
  };
  if (!data.results || !Array.isArray(data.results.entities)) return;
  const valid: QlooEntity[] = [];
  let invalid = 0;
  data.results.entities.forEach((raw, index) => {
    const parsed = entitySchema.safeParse(raw);
    if (parsed.success)
      valid.push({ ...parsed.data, rabbitOriginalPosition: index + 1 });
    else invalid++;
  });
  // A wholly malformed nonempty collection still fails the wire contract.
  if (!data.results.entities.length || valid.length) {
    data.results.entities = valid;
    if (invalid) data.rabbitInvalidCount = invalid;
  }
}

/** Conservative supported projection: exact confirmed input IDs mapped to finite
 * normalized contributions. Unknown vendor shapes stay in the private validated
 * response cache and are explicitly unsupported, never converted into prose. */
export function explanationProjection(
  raw: unknown,
  inputs: Entity[],
): NonNullable<Evidence["results"][number]["explanation"]> {
  if (raw == null) return { status: "missing", contributions: [] };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const named = (raw as Record<string, unknown>)["signal.interests.entities"];
    const entries: [string, unknown][] = Array.isArray(named)
      ? named.map((item) => [
          typeof item?.entity_id === "string"
            ? item.entity_id.toLowerCase()
            : "",
          item?.score,
        ])
      : Object.entries(raw).map(([id, value]) => [id.toLowerCase(), value]);
    if (
      entries.length &&
      new Set(entries.map(([id]) => id)).size === entries.length &&
      entries.every(
        ([id, value]) =>
          inputs.some((e) => e.id.toLowerCase() === id) &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1,
      )
    )
      return {
        status: "returned",
        contributions: entries.map(([entityId, value]) => ({
          entityId,
          value: value as number,
        })),
      };
  }
  return { status: "unsupported", contributions: [] };
}

export function invalidRequiredSignal(warnings: unknown, signals: string[]) {
  return (
    Array.isArray(warnings) &&
    warnings.some(
      (warning) =>
        warning?.type === "not_found" &&
        Array.isArray(warning["signal.interests.entities"]) &&
        warning["signal.interests.entities"].some(
          (id: unknown) =>
            typeof id === "string" && signals.includes(id.toLowerCase()),
        ),
    )
  );
}
