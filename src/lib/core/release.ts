import "server-only";
import type { Sql } from "postgres";
import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import curated from "./demo-catalog.json";
import { comparisons, type ComparisonCase } from "./comparisons";
import {
  COMPARISON_PROMPT,
  executeComparisonArm,
  type FrozenBrief,
} from "./comparison-runner";
import { releaseSampleSchema } from "./activated-samples";
import { evaluationId } from "./evaluation-id";
import { AppError, assert } from "./errors";
import { modelBound, reserveModelBudget } from "./limits";
import { INPUT_RATE, OUTPUT_RATE, verifiedModelConfig } from "./model-config";
import { PostgresRecords } from "./postgres";
import { qlooPort, type QlooPort, type DiscoveryResult } from "./qloo";
import type { AtomicStore, RedisPort } from "./store";
import type { Entity, Medium } from "./types";

export const DEMO_VERSION = "release-demo-v1";
export const RELEASE_QLOO_CAP = 30;
export const RELEASE_MODEL_CAP = 100_000; // $0.10 in microdollars

export class ReleaseBudget {
  qlooAttempts = 0;
  modelReserved = 0;
  beforeQloo = () => {
    assert(this.qlooAttempts < RELEASE_QLOO_CAP, "paused", 503);
    this.qlooAttempts++;
  };
  reserveModel() {
    // The comparison runner enforces four steps, 8k input and 1024 output
    // tokens per step, no retries. Unknown/failed usage is never refunded.
    const amount = modelBound(INPUT_RATE, OUTPUT_RATE);
    assert(this.modelReserved + amount <= RELEASE_MODEL_CAP, "paused", 503);
    this.modelReserved += amount;
    return amount;
  }
}

export interface DemoRecords {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
}
export function demoRecords(sql: Sql, namespace: string): DemoRecords {
  const records = new PostgresRecords(sql);
  const key = (id: string) => `${namespace}:${DEMO_VERSION}:${id}`;
  return {
    get: <T>(id: string) => records.get<T>(key(id)),
    async put(id, value) {
      await sql`
        INSERT INTO rabbit_hole_records (key, body)
        VALUES (${key(id)}, ${JSON.stringify(value)})
        ON CONFLICT (key) DO NOTHING
      `;
    },
  };
}

type PreparedCatalog = { all: Entity[]; eligible: Entity[] };
type ReleaseSample = z.infer<typeof releaseSampleSchema>;
export interface WarmOptions {
  records: DemoRecords;
  redis: RedisPort;
  namespace: string;
  storage: AtomicStore;
  budget: ReleaseBudget;
  port: QlooPort;
  model: string;
  signal: AbortSignal;
  executeArm: typeof executeComparisonArm;
  log: (event: Record<string, unknown>) => void;
}

/** Persist every successful stage before moving on. No startup/page calls, no
 * disk imports, and no human review attestations are fabricated by automation. */
export async function warmDemo(options: WarmOptions) {
  const { records, redis, namespace, budget, port, signal, log } = options;
  const prepared = new Map<Medium, PreparedCatalog>();
  const checkpoint = async <T>(key: string, work: () => Promise<T>) => {
    const saved = await records.get<T>(key);
    if (saved !== null) return saved;
    signal.throwIfAborted();
    const value = await work();
    await records.put(key, value);
    return value;
  };
  const catalog = async (medium: Medium) => {
    if (prepared.has(medium)) return prepared.get(medium)!;
    const result = await checkpoint<PreparedCatalog>(
      `catalog:${medium}`,
      async () => {
        const expected = curated.filter((item) => item.medium === medium);
        const ids = expected.map((item) => item.id);
        const all = await port.describeEntities(ids, medium);
        // Canonical IDs are curated, but names/types must still match live Qloo.
        const nameKey = (name: string) =>
          name
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "");
        assert(
          all.length === ids.length &&
            all.every(
              (item) =>
                item.source === "Qloo" &&
                item.medium === medium &&
                expected.some(
                  (row) =>
                    row.id === item.id &&
                    nameKey(row.name) === nameKey(item.name),
                ),
            ),
          "contract",
          502,
        );
        // Same cached hydration response; filtering uses current content policy.
        const eligible = await port.describeEntities(ids, medium, true);
        assert(eligible.length > 0, "contract", 502);
        return { all, eligible };
      },
    );
    prepared.set(medium, result);
    return result;
  };
  const output: ComparisonCase[] = [];
  const samples: ReleaseSample[] = [];
  for (const [index, example] of comparisons.entries()) {
    try {
      const pair = await checkpoint<ComparisonCase>(
        `comparison:${example.id}`,
        async () => {
          const brief = await checkpoint<FrozenBrief>(
            `brief:${example.id}`,
            async () => {
              const seeds = await catalog(example.seed.medium);
              const seed = seeds.all.find(
                (item) => item.name === example.seed.name,
              );
              assert(seed, "contract", 502);
              const candidates = (await catalog(example.destination)).eligible;
              return {
                id: example.id,
                seed,
                medium: example.destination,
                catalog: candidates,
                eligibleIds: candidates.map((item) => item.id),
                explicitLoves: [],
                exclusions: [seed.id],
                lessObvious: false,
                frozenAt: new Date().toISOString(),
                catalogVersion: DEMO_VERSION,
              };
            },
          );
          if (index < 3) {
            await checkpoint<DiscoveryResult>(
              `opening:${example.id}`,
              async () => {
                const discovery = await port.insights({
                  anchor: brief.seed,
                  medium: brief.medium,
                  exclusions: [brief.seed.id],
                  lessObvious: false,
                });
                assert(
                  discovery.entities.length > 0 &&
                    discovery.evidence.source === "qloo",
                  "contract",
                  502,
                );
                return discovery;
              },
            );
          }
          const arms: ComparisonCase["arms"] = [];
          for (const condition of ["with", "without"] as const) {
            const arm = await checkpoint<ComparisonCase["arms"][number]>(
              `arm:${example.id}:${condition}`,
              async () => {
                signal.throwIfAborted();
                assert(process.env.INFERENCE_PAUSED !== "1", "paused", 503);
                const reservation = budget.reserveModel();
                await options.storage.transact((db) =>
                  reserveModelBudget(db, reservation, Date.now()),
                );
                const result = await options.executeArm(brief, condition, {
                  model: createAnthropic()(options.model),
                  signal,
                  onStep: async () => {
                    signal.throwIfAborted();
                  },
                  affinity: () =>
                    checkpoint(`affinity:${example.id}`, () =>
                      port.insights({
                        anchor: brief.seed,
                        medium: brief.medium,
                        exclusions: brief.exclusions,
                        lessObvious: false,
                        catalog: brief.catalog,
                      }),
                    ),
                });
                log({
                  stage: "arm",
                  case: example.id,
                  condition,
                  steps: result.modelSteps,
                  actualMicrodollars: result.actualCost,
                });
                return {
                  condition,
                  entities: result.ids.map((id) =>
                    brief.catalog.find((item) => item.id === id)!,
                  ),
                  status: result.ids.length ? "ok" : "empty",
                  note: "Saved live Haiku selection from the same curated, frozen catalog.",
                  ...(result.evidence ? { evidence: result.evidence } : {}),
                };
              },
            );
            arms.push(arm);
          }
          return {
            ...example,
            seed: brief.seed,
            catalog: brief.catalog,
            eligibleIds: brief.eligibleIds,
            source: "qloo",
            frozenAt: brief.frozenAt,
            catalogVersion: DEMO_VERSION,
            promptVersion: COMPARISON_PROMPT,
            model: options.model,
            arms,
            constraints: {
              loves: [],
              excluded: brief.exclusions,
              lessObvious: false,
            },
          };
        },
      );
      const identified = { ...pair, evaluationId: evaluationId(pair) };
      output.push(identified);
      if (index < 3)
        samples.push(
          releaseSampleSchema.parse({
            identity: pair.seed,
            preparedAt: pair.frozenAt,
            method: "live-discovery-and-model-selection",
            comparisonId: identified.evaluationId,
          }),
        );
      log({ stage: "ready", case: example.id });
    } catch (error) {
      // Provider errors can contain credentials/requests. Log only our safe code.
      log({
        stage: "unavailable",
        case: example.id,
        reason: error instanceof AppError ? error.code : "warming",
      });
    }
  }
  // Restore projections from Postgres even if expiring KV caches were evicted.
  // Existing operator-reviewed activations remain independently available.
  if (samples.length === 3) await redis.set(`${namespace}:samples:v2`, samples);
  if (output.length) {
    for (const pair of output)
      await redis.set(`${namespace}:evaluation:${pair.evaluationId}`, pair);
    await redis.set(
      `${namespace}:comparisons:v2`,
      output.map((pair) => pair.evaluationId),
    );
  }
  return {
    samples: samples.length === 3 ? 3 : 0,
    comparisons: output.length,
    qlooAttempts: budget.qlooAttempts,
    modelReservedMicrodollars: budget.modelReserved,
  };
}

export async function prepareDemo(
  sql: Sql,
  redis: RedisPort,
  storage: AtomicStore,
  log: WarmOptions["log"],
) {
  assert(
    process.env.QLOO_API_KEY && process.env.ANTHROPIC_API_KEY,
    "configuration",
    503,
  );
  assert(process.env.QLOO_MODE !== "fixture", "configuration", 503);
  const { model } = await verifiedModelConfig();
  const namespace = `rabbit-hole:${process.env.ENTITLEMENT_NAMESPACE || "default"}`;
  const budget = new ReleaseBudget();
  const signal = AbortSignal.timeout(8 * 60_000);
  const sampleIds = curated
    .filter((item) =>
      comparisons
        .slice(0, 3)
        .some((example) => example.seed.name === item.name),
    )
    .map((item) => item.id);
  const port = qlooPort({
    storage,
    owner: DEMO_VERSION,
    mode: "live",
    signal,
    beforeAttempt: budget.beforeQloo,
    publicSampleIds: sampleIds,
  });
  return warmDemo({
    records: demoRecords(sql, namespace),
    redis,
    namespace,
    storage,
    budget,
    port,
    model,
    signal,
    executeArm: executeComparisonArm,
    log,
  });
}
